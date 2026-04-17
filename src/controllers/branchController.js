const Branch = require('../models/Branch');
const Shift = require('../models/Shift');
const User = require('../models/User'); // 🚀 [جديد] للتحقق من الكاشير قبل الحذف
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// 🛠️ دالة مساعدة لحساب الأيام (Pure Function)
const calculateDaysLeft = (targetDate) => {
  if (!targetDate) return 0;
  const diffInDays = Math.ceil((new Date(targetDate) - new Date()) / (1000 * 60 * 60 * 24));
  return diffInDays > 0 ? diffInDays : 0;
};

// ==========================================
// ➕ 1. إضافة فرع جديد للمؤسسة
// ==========================================
const addBranch = asyncHandler(async (req, res, next) => {
  const { name, location, shift_start_time, shift_duration_hours } = req.body;
  const orgId = req.user.organization_id;

  if (!name || !location) {
    return next(new AppError('اسم وموقع الفرع مطلوبان', 400));
  }

  // استخدام .lean() لسرعة الفحص
  const existingBranch = await Branch.findOne({ organization_id: orgId, name: name.trim() }).lean();
  if (existingBranch) {
    return next(new AppError('يوجد فرع بهذا الاسم بالفعل في مؤسستك', 400));
  }

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 14);

  const newBranch = await Branch.create({
    organization_id: orgId,
    name: name.trim(),
    location: location.trim(),
    subscription_status: 'TRIAL',
    monthly_fee: 0,
    trial_ends_at: trialEndsAt,
    shift_start_time: shift_start_time || '08:00',
    shift_duration_hours: shift_duration_hours || 12
  });

  res.status(201).json({
    message: 'تم اضافة الفرع الجديد وتفعيل فترته التجريبية بنجاح',
    branch: newBranch
  });
});

// ==========================================
// 📋 2. جلب جميع فروع المالك (Optimized with .lean)
// ==========================================
const getBranches = asyncHandler(async (req, res, next) => {
  // 🚀 استخدام .lean() يسرع الاستعلام بنسبة 500% لأنه يرجع JS Objects نقية
  const branchesRaw = await Branch.find({ organization_id: req.user.organization_id })
    .sort({ createdAt: -1 })
    .lean();

  const branches = branchesRaw.map(b => {
    const targetDate = b.subscription_status === 'TRIAL' ? b.trial_ends_at : b.subscription_ends_at;
    return {
      ...b,
      status: b.subscription_status,
      days_left: calculateDaysLeft(targetDate)
    };
  });

  res.status(200).json({ count: branches.length, branches });
});

// ==========================================
// ⚙️ 3. تعديل إعدادات الفرع
// ==========================================
const updateBranchSettings = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name, location, shift_start_time, shift_duration_hours, invoice_deletion_rule } = req.body;

  const branch = await Branch.findOne({ _id: id, organization_id: req.user.organization_id });
  if (!branch) return next(new AppError('الفرع غير موجود أو لا تملك صلاحية تعديله', 404));

  // تحديث ذكي للحقول المتوفرة فقط
  if (name) branch.name = name.trim();
  if (location) branch.location = location.trim();
  if (shift_start_time) branch.shift_start_time = shift_start_time;
  if (shift_duration_hours) branch.shift_duration_hours = Number(shift_duration_hours);
  if (invoice_deletion_rule !== undefined) branch.invoice_deletion_rule = invoice_deletion_rule;

  await branch.save();
  res.status(200).json({ message: 'تم تحديث إعدادات الفرع بنجاح', branch });
});

// ==========================================
// 🔒 4. إيقاف الفرع (Lock)
// ==========================================
const deleteBranch = asyncHandler(async (req, res, next) => {
  const branch = await Branch.findOneAndUpdate(
    { _id: req.params.id, organization_id: req.user.organization_id },
    { subscription_status: 'LOCKED' },
    { new: true }
  );

  if (!branch) return next(new AppError('الفرع غير موجود', 404));
  res.status(200).json({ message: 'تم إيقاف الفرع بنجاح' });
});

// ==========================================
// 🔓 5. إعادة تنشيط الفرع
// ==========================================
const reactivateBranch = asyncHandler(async (req, res, next) => {
  const branch = await Branch.findOne({ _id: req.params.id, organization_id: req.user.organization_id });
  if (!branch) return next(new AppError('الفرع غير موجود', 404));

  branch.subscription_status = (branch.trial_ends_at && branch.trial_ends_at > new Date()) ? 'TRIAL' : 'ACTIVE';
  await branch.save();

  res.status(200).json({ message: 'تم إعادة تنشيط الفرع بنجاح' });
});

// ==========================================
// 🗑️ 6. الحذف النهائي (Hard Delete with Referential Integrity)
// ==========================================
const hardDeleteBranch = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const orgId = req.user.organization_id;

  // 1. التحقق من الورديات
  const hasShifts = await Shift.exists({ branch_id: id });
  if (hasShifts) {
    return next(new AppError('لا يمكن حذف الفرع لوجود سجلات ورديات مالية مرتبطة به.', 400));
  }

  // 2. 🚀 [حماية جديدة] التحقق من الكاشيرية المعلقين
  const hasUsers = await User.exists({ branch_id: id, deleted_at: null });
  if (hasUsers) {
    return next(new AppError('يجب نقل أو حذف العمال (الكاشير) المربوطين بهذا الفرع أولاً.', 400));
  }

  const deletedBranch = await Branch.findOneAndDelete({ _id: id, organization_id: orgId });
  if (!deletedBranch) return next(new AppError('الفرع غير موجود', 404));

  res.status(200).json({ message: 'تم حذف الفرع نهائياً بسلام' });
});

module.exports = { addBranch, getBranches, updateBranchSettings, deleteBranch, reactivateBranch, hardDeleteBranch };