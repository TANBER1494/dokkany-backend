const User = require('../models/User');
const Branch = require('../models/Branch');
const bcrypt = require('bcryptjs');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// Get all owners with their organizations
const getAllOwners = asyncHandler(async (req, res, next) => {
  const owners = await User.find({ role: 'OWNER', deleted_at: null })
    .populate('organization_id', 'name phone max_allowed_branches')
    .select('-password_hash -pin_code -refresh_token -current_session_id')
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json({ count: owners.length, owners });
});

// Get all branches with subscription details
const getAllBranches = asyncHandler(async (req, res, next) => {
  const branches = await Branch.find()
    .populate('organization_id', 'name owner_name phone')
    .sort({ createdAt: -1 })
    .lean();

  const branchesWithDetails = branches.map(branch => {
    let daysLeft = 0;
    const targetDate = branch.subscription_status === 'TRIAL' 
      ? branch.trial_ends_at 
      : branch.subscription_ends_at;

    if (targetDate) {
      const diffTime = new Date(targetDate).getTime() - new Date().getTime();
      daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (daysLeft < 0) daysLeft = 0;
    }

    return {
      ...branch,
      days_left: daysLeft
    };
  });

  res.status(200).json({ count: branchesWithDetails.length, branches: branchesWithDetails });
});

// Reset owner password by Super Admin
const adminResetUserPassword = asyncHandler(async (req, res, next) => {
  const { phone, new_password } = req.body;

  if (!phone || !new_password) {
    return next(new AppError('رقم الهاتف وكلمة المرور الجديدة مطلوبان', 400));
  }

  if (new_password.length < 6) {
    return next(new AppError('كلمة المرور المؤقتة يجب ألا تقل عن 6 أحرف', 400));
  }

  const user = await User.findOne({ phone, deleted_at: null });
  
  if (!user) {
    return next(new AppError('هذا الرقم غير مسجل لأي مستخدم في النظام', 404));
  }

  if (user.role === 'SUPER_ADMIN' && user._id.toString() !== req.user._id.toString()) {
    return next(new AppError('إجراء أمني: لا يمكنك تغيير كلمة مرور مدير أعلى آخر', 403));
  }

  const salt = await bcrypt.genSalt(10);
  user.password_hash = await bcrypt.hash(new_password, salt);
  
  user.current_session_id = null; 
  user.refresh_token = null;

  await user.save();

  res.status(200).json({ 
    message: 'تم إعادة تعيين كلمة المرور بنجاح',
    user: { name: user.name, phone: user.phone, role: user.role }
  });
});

// Super Admin self password update
const adminUpdatePassword = asyncHandler(async (req, res, next) => {
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

  const admin = await User.findById(req.user._id).select('+password_hash');
  
  const isMatch = await bcrypt.compare(current_password, admin.password_hash);
  if (!isMatch) {
    return next(new AppError('كلمة المرور الحالية غير صحيحة', 401));
  }

  const salt = await bcrypt.genSalt(10);
  admin.password_hash = await bcrypt.hash(new_password, salt);
  await admin.save();

  res.status(200).json({ message: 'تم تحديث كلمة المرور الخاصة بك بنجاح' });
});

module.exports = { 
  getAllOwners, 
  getAllBranches, 
  adminResetUserPassword, 
  adminUpdatePassword 
};