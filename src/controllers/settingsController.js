const User = require('../models/User');
const Branch = require('../models/Branch');
const bcrypt = require('bcryptjs');

const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// 📥 1. جلب جميع إعدادات المالك الحالية
// ==========================================
const getSettings = asyncHandler(async (req, res, next) => {
  const orgId = req.user.organization_id;

  const [user, branch] = await Promise.all([
    User.findById(req.user._id).select('phone is_dark_mode notifications').lean(),
    Branch.findOne({ organization_id: orgId }).select('is_deletion_allowed deletion_window_minutes').lean()
  ]);

  if (!user) return next(new AppError('المستخدم غير موجود', 404));

  res.status(200).json({
    phone: user.phone,
    is_dark_mode: user.is_dark_mode,
    notifications: user.notifications,
    is_deletion_allowed: branch ? branch.is_deletion_allowed : true,
    deletion_window_minutes: branch ? branch.deletion_window_minutes : 15,
  });
});

// ==========================================
// 📱 2. تغيير رقم الهاتف
// ==========================================
const updatePhone = asyncHandler(async (req, res, next) => {
  const { new_phone } = req.body;
  
  if (!new_phone || !/^01[0125][0-9]{8}$/.test(new_phone)) {
    return next(new AppError('رقم الهاتف الجديد غير صحيح', 400));
  }

  const user = await User.findById(req.user._id);
  if (user.phone === new_phone) {
    return res.status(200).json({ message: 'هذا هو رقمك الحالي بالفعل', phone: user.phone });
  }

  const existingUser = await User.exists({ phone: new_phone });
  if (existingUser) {
    return next(new AppError('هذا الرقم مسجل بحساب آخر بالفعل', 400));
  }

  user.phone = new_phone;
  await user.save();
  
  res.status(200).json({ message: 'تم تحديث رقم الهاتف بنجاح', phone: user.phone });
});

// ==========================================
// 🔐 3. تغيير كلمة المرور
// ==========================================
const updatePassword = asyncHandler(async (req, res, next) => {
  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password || !confirm_password) {
    return next(new AppError('جميع حقول كلمة المرور مطلوبة', 400));
  }
  if (new_password !== confirm_password) {
    return next(new AppError('كلمة المرور الجديدة غير متطابقة', 400));
  }
  if (new_password.length < 6) {
    return next(new AppError('كلمة المرور يجب أن تكون 6 أحرف على الأقل', 400));
  }

  const user = await User.findById(req.user._id).select('+password_hash');
  
  const isMatch = await bcrypt.compare(current_password, user.password_hash);
  if (!isMatch) return next(new AppError('كلمة المرور الحالية غير صحيحة', 401));

  const salt = await bcrypt.genSalt(10);
  user.password_hash = await bcrypt.hash(new_password, salt);
  await user.save();

  res.status(200).json({ message: 'تم تحديث كلمة المرور بنجاح' });
});

// ==========================================
// ⚙️ 4. تحديث التفضيلات وإعدادات الفواتير المتقدمة
// ==========================================
const updatePreferences = asyncHandler(async (req, res, next) => {
  const { is_dark_mode, notifications, is_deletion_allowed, deletion_window_minutes } = req.body;
  const orgId = req.user.organization_id;

  const user = await User.findById(req.user._id);
  if (is_dark_mode !== undefined) user.is_dark_mode = is_dark_mode;
  if (notifications) user.notifications = notifications;
  await user.save();

  // تحديث قاعدة الفواتير المتقدمة لجميع فروع هذا المالك
  let updateFields = {};
  if (is_deletion_allowed !== undefined) updateFields.is_deletion_allowed = is_deletion_allowed;
  if (deletion_window_minutes !== undefined) updateFields.deletion_window_minutes = Number(deletion_window_minutes);

  if (Object.keys(updateFields).length > 0) {
    await Branch.updateMany({ organization_id: orgId }, { $set: updateFields });
  }

  res.status(200).json({ message: 'تم حفظ التفضيلات بنجاح' });
});

module.exports = { getSettings, updatePhone, updatePassword, updatePreferences };