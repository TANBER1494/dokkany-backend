const mongoose = require('mongoose');
const PlatformPayment = require('../models/PlatformPayment');
const Branch = require('../models/Branch');
const Notification = require('../models/Notification');
const socket = require('../models/socket'); 

const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// 1. (Owner) Submit Payment Request
// ==========================================
const submitPaymentRequest = asyncHandler(async (req, res, next) => {
  const { branch_id, amount_paid, transfer_number, requested_months } = req.body;
  const orgId = req.user.organization_id;

  const numAmount = Number(amount_paid);
  const numMonths = Number(requested_months);

  if (!branch_id || isNaN(numAmount) || numAmount <= 0 || !transfer_number || isNaN(numMonths) || numMonths <= 0) {
    return next(new AppError('جميع الحقول (الفرع، المبلغ الصحيح، رقم التحويل، ومدة الباقة الصحيحة) مطلوبة', 400));
  }

  if (!req.file || !req.file.path) {
    return next(new AppError('صورة إيصال التحويل مطلوبة لاعتماد الدفع', 400));
  }

  const branch = await Branch.exists({ _id: branch_id, organization_id: orgId });
  if (!branch) return next(new AppError('الفرع غير موجود أو لا تملك صلاحية عليه', 404));

  const newPayment = await PlatformPayment.create({
    organization_id: orgId,
    branch_id,
    amount_paid: numAmount,
    transfer_number: transfer_number.trim(),
    requested_months: numMonths,
    payment_method: 'VODAFONE_CASH',
    receipt_image_url: req.file.path 
  });

  // Asynchronous Notification to Super Admin
  try {
    console.log('⏳ جاري حفظ الإشعار في قاعدة البيانات...');
    
    const notification = await Notification.create({
      organization_id: orgId,    // 👈 تمرير إجباري لإرضاء Mongoose
      branch_id: branch_id,      // 👈 تمرير إجباري لتجنب أي أخطاء
      target_role: 'SUPER_ADMIN',
      title: 'طلب تجديد اشتراك جديد 💳',
      message: `قام المالك برفع إيصال دفع بمبلغ ${numAmount} ج.م بانتظار مراجعتك.`,
      type: 'SYSTEM',
      link: '/admin/payments'
    });

    console.log('✅ تم الحفظ بالداتابيز، جاري الإرسال عبر السوكيت...');
    
    const io = socket.getIO();
    // إرسال الكائن بعد تحويله لضمان توافقه مع السوكيت
    io.to('SUPER_ADMIN_ROOM').emit('new_notification', notification.toJSON ? notification.toJSON() : notification);
    
    console.log('🔔 تم بث الإشعار بنجاح لغرفة الأدمن!');

  } catch (notifErr) {
    console.error('🚨 خطأ صامت منع إرسال الإشعار:', notifErr.message);
  }

  res.status(201).json({ 
    message: 'تم إرسال طلب التجديد بنجاح! سيتم تفعيل الباقة فور مراجعة الإيصال.', 
    payment: newPayment 
  });
});

// ==========================================
// 2. (Owner) Get Payment History (Full Ledger)
// ==========================================
const getOwnerPaymentHistory = asyncHandler(async (req, res, next) => {
  const orgId = req.user.organization_id;

  // نجلب كل الطلبات (مقبولة، مرفوضة، معلقة) التي لم يقم المالك بإخفائها
  const payments = await PlatformPayment.find({ 
    organization_id: orgId,
    is_deleted_by_owner: false 
  })
  .populate('branch_id', 'name')
  .sort({ createdAt: -1 })
  .lean();

  res.status(200).json(payments);
});

// ==========================================
// 🚀 [جديد] (Owner) Clear Branch History (Soft Delete)
// ==========================================
const clearBranchHistory = asyncHandler(async (req, res, next) => {
  const orgId = req.user.organization_id;
  const { branchId } = req.params;

  // إخفاء جميع سجلات هذا الفرع من شاشة المالك (Soft Delete)
  await PlatformPayment.updateMany(
    { organization_id: orgId, branch_id: branchId },
    { $set: { is_deleted_by_owner: true } }
  );

  res.status(200).json({ message: 'تم تنظيف السجل بنجاح' });
});

// ==========================================
// 3. (Admin) Get Pending Payments
// ==========================================
const getPendingPayments = asyncHandler(async (req, res, next) => {
  const pendingPayments = await PlatformPayment.find({ status: 'PENDING' })
    .populate('organization_id', 'name phone')
    .populate('branch_id', 'name subscription_status subscription_ends_at')
    .sort({ createdAt: 1 })
    .lean();

  res.status(200).json(pendingPayments);
});

// ==========================================
// 4. (Admin) Review Payment Request (ACID Transaction)
// ==========================================
const reviewPaymentRequest = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { action, admin_notes } = req.body; 

  const payment = await PlatformPayment.findById(id);
  if (!payment) return next(new AppError('طلب الدفع غير موجود', 404));

  if (payment.status !== 'PENDING') {
    return next(new AppError(`هذا الطلب تمت مراجعته مسبقاً وحالته: ${payment.status}`, 400));
  }

  if (action === 'REJECT') {
    payment.status = 'REJECTED';
    payment.admin_notes = admin_notes ? admin_notes.trim() : 'تم رفض الطلب لعدم تطابق البيانات، يرجى مراجعة الإدارة.';
    await payment.save();
    return res.status(200).json({ message: 'تم رفض طلب الدفع بنجاح' });
  }

  if (action === 'APPROVE') {
    const branch = await Branch.findById(payment.branch_id);
    if (!branch) return next(new AppError('الفرع المرتبط بهذا الطلب لم يعد موجوداً', 404));

    const now = new Date();
    let newStartDate = now;

    if (branch.subscription_status === 'ACTIVE' && branch.subscription_ends_at && branch.subscription_ends_at > now) {
      newStartDate = new Date(branch.subscription_ends_at);
    }

    const newEndDate = new Date(newStartDate);
    newEndDate.setMonth(newEndDate.getMonth() + payment.requested_months);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      branch.subscription_status = 'ACTIVE';
      branch.subscription_ends_at = newEndDate;
      await branch.save({ session });

      payment.status = 'APPROVED';
      payment.admin_notes = admin_notes ? admin_notes.trim() : 'تم استلام المبلغ وتمديد الاشتراك بنجاح.';
      await payment.save({ session });

      const [notification] = await Notification.create([{
        organization_id: payment.organization_id,
        branch_id: branch._id,
        target_role: 'OWNER',
        title: 'تم تفعيل اشتراك الفرع!',
        message: `تمت مراجعة إيصال الدفع بنجاح، وتفعيل اشتراك فرع (${branch.name}) لمدة ${payment.requested_months} شهر/شهور.`,
        type: 'SYSTEM',
        link: '/owner/branches'
      }], { session });

      await session.commitTransaction();
      session.endSession();

      const io = socket.getIO();
      io.to(payment.organization_id.toString()).emit('new_notification', notification);

      return res.status(200).json({ 
        message: `تم اعتماد المبلغ وتمديد اشتراك الفرع بنجاح لمدة ${payment.requested_months} شهر/شهور.`,
        new_end_date: newEndDate 
      });

    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('Review Payment Transaction Error:', error);
      return next(new AppError('حدث خطأ أثناء حفظ الموافقة وتفعيل الفرع، تم التراجع لحماية النظام', 500));
    }
  }

  return next(new AppError('إجراء غير معروف (يجب أن يكون APPROVE أو REJECT)', 400));
});

module.exports = { submitPaymentRequest, getOwnerPaymentHistory, getPendingPayments, reviewPaymentRequest, clearBranchHistory };