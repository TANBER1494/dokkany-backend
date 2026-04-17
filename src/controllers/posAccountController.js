const User = require('../models/User');
const Branch = require('../models/Branch'); // 👈 [جديد] للتحقق من الفرع
const bcrypt = require('bcryptjs');

const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// 🖥️ 1. جلب بيانات حساب نقطة البيع لفرع معين
// ==========================================
const getPosAccount = asyncHandler(async (req, res, next) => {
  const { branchId } = req.params;
  const orgId = req.user.organization_id;

  // 🚀 استخدام .lean() واستبعاد الباسورد
  const posAccount = await User.findOne({ 
    branch_id: branchId, organization_id: orgId, role: 'CASHIER', deleted_at: null
  }).select('phone name').lean();

  if (!posAccount) return res.status(200).json({ has_account: false });

  res.status(200).json({ 
    has_account: true, 
    account: { id: posAccount._id, phone: posAccount.phone, name: posAccount.name }
  });
});

// ==========================================
// ⚙️ 2. إنشاء أو تحديث حساب نقطة البيع (Secured Upsert)
// ==========================================
const upsertPosAccount = asyncHandler(async (req, res, next) => {
  const { branchId } = req.params;
  const { phone, password, name } = req.body;
  const orgId = req.user.organization_id;

  if (!phone) return next(new AppError('رقم الهاتف مطلوب لحساب الكاشير', 400));

  // 🛡️ [حماية جراحية] التأكد أن الفرع موجود ويتبع للمالك، لمنع ثغرة الـ Branch Spoofing
  const branchExists = await Branch.exists({ _id: branchId, organization_id: orgId });
  if (!branchExists) return next(new AppError('الفرع المحدد غير موجود أو لا تتبع له', 403));

  // جلب الحساب الحالي لهذا الفرع (إن وجد)، وجلب المستخدم صاحب هذا الرقم (إن وجد)
  const [existingPhoneUser, currentPosAccount] = await Promise.all([
    User.findOne({ phone, deleted_at: null }).lean(),
    User.findOne({ branch_id: branchId, organization_id: orgId, role: 'CASHIER', deleted_at: null })
  ]);

  // ==========================
  // 🔄 حالة التحديث (يوجد حساب مسبقاً للفرع)
  // ==========================
  if (currentPosAccount) {
    if (existingPhoneUser && existingPhoneUser._id.toString() !== currentPosAccount._id.toString()) {
      return next(new AppError('رقم الهاتف مستخدم لحساب آخر في النظام', 400));
    }
    
    currentPosAccount.phone = phone.trim();
    if (name) currentPosAccount.name = name.trim();
    
    if (password) {
      if (password.length < 6) return next(new AppError('كلمة المرور يجب ألا تقل عن 6 أحرف', 400));
      const salt = await bcrypt.genSalt(10);
      currentPosAccount.password_hash = await bcrypt.hash(password, salt);
    }
    
    await currentPosAccount.save();
    return res.status(200).json({ message: 'تم تحديث بيانات حساب نقطة البيع بنجاح' });
  } 
  
  // ==========================
  // ➕ حالة الإنشاء (أول مرة يتم إنشاء حساب للفرع)
  // ==========================
  else {
    if (existingPhoneUser) return next(new AppError('رقم الهاتف مستخدم بالفعل لحساب آخر', 400));
    if (!password) return next(new AppError('كلمة المرور مطلوبة لإنشاء حساب جديد', 400));
    if (password.length < 6) return next(new AppError('كلمة المرور يجب ألا تقل عن 6 أحرف', 400));

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    await User.create({
      organization_id: orgId,
      branch_id: branchId,
      name: name ? name.trim() : 'جهاز الكاشير',
      role: 'CASHIER',
      employee_title: 'NOT_APPLICABLE',
      phone: phone.trim(),
      password_hash
    });

    return res.status(201).json({ message: 'تم إنشاء حساب نقطة البيع للفرع بنجاح' });
  }
});

module.exports = { getPosAccount, upsertPosAccount };