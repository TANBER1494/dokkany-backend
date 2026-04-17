const CashFlow = require('../models/CashFlow');
const Shift = require('../models/Shift');
const Vendor = require('../models/Vendor');
const User = require('../models/User');
const Branch = require('../models/Branch');
const Notification = require('../models/Notification');
const socket = require('../models/socket');

const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// 🛠️ دالة مساعدة لعزل لوجيك الإشعارات (حتى لا يعطل الكود الرئيسي)
const sendCashFlowNotifications = async (type, numAmount, description, vendorName, branchId, orgId) => {
  try {
    const branch = await Branch.findById(branchId).lean();
    const owner = await User.findOne({ organization_id: orgId, role: 'OWNER' }).select('notifications').lean();
    const io = socket.getIO();

    if (type === 'VENDOR_PAYMENT' && owner?.notifications?.vendor_payment !== false) {
      const notif = await Notification.create({
        organization_id: orgId, branch_id: branchId, target_role: 'OWNER',
        title: 'سداد دفعة لمورد',
        message: `تم سداد مبلغ ${numAmount} ج.م نقداً من الدرج للمورد (${vendorName}) في فرع (${branch.name}).`,
        type: 'LARGE_EXPENSE', link: '/owner/shifts'
      });
      io.to(orgId.toString()).emit('new_notification', notif);
    }

    if (type === 'EXPENSE' && numAmount >= 1000 && owner?.notifications?.large_expense !== false) {
      const notif = await Notification.create({
        organization_id: orgId, branch_id: branchId, target_role: 'OWNER',
        title: 'إنذار: مصروفات ضخمة من الخزينة ⚠️',
        message: `تم سحب مبلغ ${numAmount} ج.م من درج فرع (${branch.name}). البيان: ${description || 'غير محدد'}`,
        type: 'LARGE_EXPENSE', link: '/owner/shifts'
      });
      io.to(orgId.toString()).emit('new_notification', notif);
    }
  } catch (error) {
    console.error('Non-blocking Notification Error:', error);
  }
};

// ==========================================
// 💸 1. تسجيل حركة خزينة جديدة
// ==========================================
const addCashFlow = asyncHandler(async (req, res, next) => {
  const { type, expense_category, amount, description, vendor_id, employee_id } = req.body;
  const branchId = req.user.branch_id;
  const orgId = req.user.organization_id;

  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return next(new AppError('يجب إدخال مبلغ صحيح أكبر من الصفر', 400));
  }

  if (!['INCOME', 'EXPENSE', 'VENDOR_PAYMENT'].includes(type)) {
    return next(new AppError('نوع الحركة غير صالح', 400));
  }

  // 1. التحقق من الوردية
  const activeShift = await Shift.findOne({ branch_id: branchId, status: 'OPEN' }).lean();
  if (!activeShift) {
    return next(new AppError('لا يمكن تسجيل أي حركة مالية، لا توجد وردية مفتوحة حالياً', 403));
  }

  // 2. التحقق من التبعيات (السلف / الموردين)
  let vendorName = '';
  if (type === 'EXPENSE' && expense_category === 'PERSONAL') {
    if (!employee_id) return next(new AppError('يجب تحديد العامل الذي استلم السلفة', 400));
    const employeeExists = await User.exists({ _id: employee_id, organization_id: orgId, deleted_at: null });
    if (!employeeExists) return next(new AppError('العامل المحدد غير موجود في النظام', 404));
  }

  if (type === 'VENDOR_PAYMENT') {
    if (!vendor_id) return next(new AppError('يجب تحديد المورد المراد الدفع له', 400));
    const vendor = await Vendor.findOne({ _id: vendor_id, organization_id: orgId, deleted_at: null }).lean();
    if (!vendor) return next(new AppError('المورد المحدد غير موجود', 404));
    vendorName = vendor.name;
  }

  // 3. إنشاء الحركة
  const cashFlow = await CashFlow.create({
    shift_id: activeShift._id,
    type,
    expense_category: type === 'EXPENSE' ? expense_category : undefined,
    amount: numAmount,
    description: description ? description.trim() : 'بدون بيان',
    vendor_id: type === 'VENDOR_PAYMENT' ? vendor_id : undefined,
    employee_id: (type === 'EXPENSE' && expense_category === 'PERSONAL') ? employee_id : undefined,
    branch_id: branchId,
    organization_id: orgId
  });

  // 4. إرسال الإشعارات بشكل غير متزامن (بدون await لكي لا نؤخر الاستجابة للكاشير)
  sendCashFlowNotifications(type, numAmount, description, vendorName, branchId, orgId);

  res.status(201).json({ message: 'تم تسجيل الحركة المالية بنجاح', cash_flow: cashFlow });
});

// ==========================================
// 📋 2. عرض حركات الخزينة لوردية محددة
// ==========================================
const getShiftCashFlows = asyncHandler(async (req, res, next) => {
  const { shift_id } = req.params;
  const branchId = req.user.role === 'CASHIER' ? req.user.branch_id : req.query.branch_id;
  const orgId = req.user.organization_id;

  if (!branchId) return next(new AppError('يجب تحديد الفرع لعرض الحركات', 400));

  if (req.user.role === 'OWNER') {
    const branchExists = await Branch.exists({ _id: branchId, organization_id: orgId });
    if (!branchExists) return next(new AppError('إجراء أمني: لا تملك صلاحية الوصول لهذا الفرع', 403));
  }

  // 🔍 الآن نبحث عن الوردية بأمان (بدون طلب orgId لأن الوردية لا تخزنه)
  const shift = await Shift.findOne({ _id: shift_id, branch_id: branchId }).lean();
  if (!shift) return next(new AppError('الوردية غير موجودة أو لا تملك صلاحية', 404));

  const cashFlows = await CashFlow.find({ shift_id })
    .populate('vendor_id', 'name company_name')
    .populate('employee_id', 'name role')
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json({ count: cashFlows.length, cashFlows });
});

// ==========================================
// 🗑️ 3. التراجع عن حركة مالية
// ==========================================
const deleteCashFlow = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const branchId = req.user.branch_id;
  const orgId = req.user.organization_id;

  // 🚀 [حماية فولاذية] التأكد من أن الحركة تخص مؤسسة هذا المستخدم
  const cashFlow = await CashFlow.findOne({ _id: id, organization_id: orgId });
  if (!cashFlow) return next(new AppError('الحركة المالية غير موجودة', 404));

  const shift = await Shift.findOne({ _id: cashFlow.shift_id, branch_id: branchId }).lean();
  if (!shift) return next(new AppError('لا تملك صلاحية التعديل على هذه الحركة', 403));

  if (shift.status === 'CLOSED') {
    return next(new AppError('لا يمكن حذف الحركة لأن الوردية مغلقة نهائياً.', 400));
  }

  await CashFlow.findByIdAndDelete(id);
  res.status(200).json({ message: 'تم التراجع عن الحركة المالية وحذفها بنجاح' });
});

module.exports = { addCashFlow, getShiftCashFlows, deleteCashFlow };