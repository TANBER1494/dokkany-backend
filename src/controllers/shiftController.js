const mongoose = require('mongoose');
const Shift = require('../models/Shift');
const CashFlow = require('../models/CashFlow');
const Branch = require('../models/Branch');
const VendorInvoice = require('../models/VendorInvoice');
const CustomerDebt = require('../models/CustomerDebt');
const User = require('../models/User'); 
const bcrypt = require('bcryptjs'); 
const Notification = require('../models/Notification');
const socket = require('../models/socket');
const { sendAppNotification } = require('../controllers/notificationController');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// 🛠️ دالة مساعدة لضمان حماية الوصول للفروع (Tenant Isolation)
const verifyBranchOwnership = async (branchId, orgId) => {
  const exists = await Branch.exists({ _id: branchId, organization_id: orgId });
  if (!exists) throw new AppError('إجراء أمني: هذا الفرع غير موجود أو لا تملك صلاحية عليه', 403);
};

// ==========================================
// 🕒 1. جلب آخر وردية مغلقة (لمعرفة العهدة)
// ==========================================
const getLastClosedShift = asyncHandler(async (req, res, next) => {
  const branchId = req.user.branch_id;

  const lastShift = await Shift.findOne({ branch_id: branchId, status: 'CLOSED' })
    .sort({ createdAt: -1 })
    .populate('cashier_id', 'name')
    .lean();

  if (!lastShift) return res.status(200).json({ has_previous: false });

  res.status(200).json({
    has_previous: true,
    last_ending_cash: lastShift.ending_cash_actual,
    last_cashier_name: lastShift.cashier_id?.name || 'غير معروف',
  });
});

// ==========================================
// 🔓 2. فتح وردية جديدة
// ==========================================
const openShift = asyncHandler(async (req, res, next) => {
  const { shift_type, initial_cash_if_first } = req.body;
  const branchId = req.user.branch_id;
  const cashierId = req.user._id;

  const existingOpenShift = await Shift.exists({ branch_id: branchId, status: 'OPEN' });
  if (existingOpenShift) {
    return next(new AppError('لا يمكن فتح وردية جديدة، هناك وردية مفتوحة بالفعل', 400));
  }

  const lastClosedShift = await Shift.findOne({ branch_id: branchId, status: 'CLOSED' }).sort({ createdAt: -1 }).lean();
  let finalStartingCash = 0;

  if (lastClosedShift) {
    finalStartingCash = lastClosedShift.ending_cash_actual;
  } else {
    const numInitial = Number(initial_cash_if_first);
    if (isNaN(numInitial) || numInitial < 0) {
      return next(new AppError('يجب إدخال عهدة افتتاح الفرع لأول مرة برقم صحيح', 400));
    }
    finalStartingCash = numInitial;
  }

  const lastShiftForSequence = await Shift.findOne({ branch_id: branchId }).sort({ shift_sequence: -1 }).lean();
  const nextSequence = lastShiftForSequence ? lastShiftForSequence.shift_sequence + 1 : 1;

  const newShift = await Shift.create({
    branch_id: branchId,
    cashier_id: cashierId,
    shift_sequence: nextSequence,
    shift_type: shift_type || 'STANDARD',
    starting_cash: finalStartingCash,
    status: 'OPEN',
    is_acknowledged: false,
  });

  res.status(201).json({
    message: `تم فتح الوردية رقم (${nextSequence}) بنجاح بعهدة ${finalStartingCash} ج`,
    shift: newShift,
  });
});

// ==========================================
// 👀 3. جلب الوردية الحالية
// ==========================================
const getActiveShift = asyncHandler(async (req, res, next) => {
  const branchId = req.user.role === 'CASHIER' ? req.user.branch_id : req.query.branch_id;
  if (!branchId) return next(new AppError('يجب تحديد الفرع لعرض الوردية الحالية', 400));
  
  if (req.user.role === 'OWNER') await verifyBranchOwnership(branchId, req.user.organization_id);

  const activeShift = await Shift.findOne({ branch_id: branchId, status: 'OPEN' })
    .populate('cashier_id', 'name phone')
    .populate('acknowledged_by', 'name')
    .populate('branch_id', 'name')
    .lean();

  if (!activeShift) return next(new AppError('لا توجد وردية مفتوحة حالياً في هذا الفرع', 404));

  res.status(200).json({ shift: activeShift });
});

// ==========================================
// 🔒 4. إغلاق الوردية الحالية (ACID Transaction 🛡️)
// ==========================================
const closeShift = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { ending_cash_actual, machines_balances } = req.body;
  const branchId = req.user.branch_id;
  const orgId = req.user.organization_id;

  const numEnding = Number(ending_cash_actual);
  if (isNaN(numEnding) || numEnding < 0) {
    return next(new AppError('يجب إدخال المبلغ الفعلي الموجود في الدرج بدقة', 400));
  }
// 🛡️ [الضربة الذرية - Atomic Lock] تمت إزالة الـ findOneAndUpdate الخارجي
  // سيتم عمل الـ Lock داخل الـ Transaction لضمان الـ Rollback لو حدث خطأ

  // 🛡️ بدء المعاملة الموحدة لحماية الدرج أولاً
  const session = await mongoose.startSession();
  session.startTransaction();

  let netShiftYield = 0;
  let shift; // تعريف المتغير في النطاق الخارجي لاستخدامه لاحقاً في الإشعار

  try {
    // 🛡️ SECURITY FIX: Find and lock inside the transaction
    shift = await Shift.findOne({ _id: id, branch_id: branchId, status: 'OPEN' }).session(session).populate('acknowledged_by');
    
    if (!shift) {
      throw new Error('SHIFT_NOT_FOUND_OR_CLOSED');
    }

    const expensesAgg = await CashFlow.aggregate([
      { $match: { shift_id: shift._id, type: { $in: ['EXPENSE', 'VENDOR_PAYMENT'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const totalExpenses = expensesAgg.length > 0 ? expensesAgg[0].total : 0;
    netShiftYield = numEnding + totalExpenses - shift.starting_cash;

    // تحديث بيانات الوردية القديمة
    shift.end_time = new Date();
    shift.ending_cash_actual = numEnding;
    shift.total_expenses = totalExpenses;
    shift.net_shift_profit = netShiftYield;
    shift.status = 'CLOSED'; // 🛡️ التحديث يتم مباشرة للحالة النهائية هنا
    if (machines_balances && Array.isArray(machines_balances)) shift.machines_balances = machines_balances;

    const nextSequence = shift.shift_sequence + 1;

    // حفظ الوردية القديمة
    await shift.save({ session });

    // إنشاء وردية جديدة معلقة
    await Shift.create([{
      branch_id: branchId,
      cashier_id: req.user._id,
      shift_sequence: nextSequence,
      shift_type: 'STANDARD',
      starting_cash: numEnding,
      status: 'OPEN',
      is_acknowledged: false,
      acknowledged_by: null,
    }], { session });

    await session.commitTransaction();
    session.endSession();
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    if (error.message === 'SHIFT_NOT_FOUND_OR_CLOSED') {
        return next(new AppError('الوردية غير موجودة، أو مغلقة مسبقاً، أو قيد الإغلاق الآن!', 400));
    }
    return next(new AppError('خطأ أثناء الإغلاق وتجهيز الدرج الجديد، تم التراجع لحفظ البيانات', 500));
  }
  
  // 🚀 إرسال الإشعار بعد نجاح العملية (خارج الـ Transaction)
  try {
    const owner = await User.findOne({ organization_id: orgId, role: 'OWNER' }).select('notifications').lean();
    if (owner?.notifications?.shift_closed !== false) {
      const branch = await Branch.findById(branchId).lean();
      const cashierName = shift.acknowledged_by ? shift.acknowledged_by.name : req.user.name;
      
      // 🚀 استدعاء المدفع الذكي الذي سيرسل للإشعارات الداخلية والموبايل (FCM) معاً!
      await sendAppNotification({
        title: 'تسليم درج وإغلاق وردية',
        message: `قام (${cashierName}) بإنهاء الوردية في فرع (${branch.name}). الصافي المورّد: ${netShiftYield} ج.م.`,
        type: 'SHIFT_END', 
        target_role: 'OWNER',
        organization_id: orgId,
        link: '/owner/shifts' 
      });
    }
  } catch (err) { console.error('Notif Error', err); }

  res.status(200).json({
    message: 'تم إغلاق الوردية وإنشاء وردية معلقة جديدة آلياً بنجاح',
    shift_summary: {
      sequence: shift.shift_sequence,
      starting_cash: shift.starting_cash,
      ending_cash_actual: shift.ending_cash_actual,
      net_shift_yield: shift.net_shift_profit,
    },
  });
});

// ==========================================
// 👤 5. استلام الوردية عبر الـ PIN (Atomic Update 🛡️)
// ==========================================
const acknowledgeShift = asyncHandler(async (req, res, next) => {
  const { employee_id, pin_code } = req.body;
  const branchId = req.user.branch_id;
  const orgId = req.user.organization_id;

  if (!employee_id || !pin_code) return next(new AppError('البيانات ناقصة لاستلام الوردية', 400));

  const employee = await User.findOne({ _id: employee_id, branch_id: branchId, deleted_at: null }).select('+pin_code').lean(); 
  if (!employee) return next(new AppError('هذا العامل غير مسجل في النظام', 404));
  if (!employee.pin_code) return next(new AppError('هذا العامل لا يملك رمز PIN.', 400));

  const isPinMatch = await bcrypt.compare(pin_code, employee.pin_code);
  if (!isPinMatch) return next(new AppError('🚨 الرمز السري (PIN) غير صحيح!', 401));

  // 🛡️ [Atomic Update]: تحديث ذري يمنع الـ Race Condition
  const activeShift = await Shift.findOneAndUpdate(
    { branch_id: branchId, status: 'OPEN', is_acknowledged: false }, // الشرط الصارم
    { $set: { is_acknowledged: true, acknowledged_at: new Date(), acknowledged_by: employee_id } },
    { new: true }
  );

  if (!activeShift) return next(new AppError('لا توجد وردية معلقة للاستلام، أو تم استلامها بالفعل', 400));

  // 🚀 إرسال الإشعار
// 🚀 إرسال الإشعار
  try {
    const owner = await User.findOne({ organization_id: orgId, role: 'OWNER' }).select('notifications').lean();
    if (owner?.notifications?.shift_opened !== false) {
      const branch = await Branch.findById(branchId).lean();
      
      // 🚀 استدعاء المدفع الذكي 
      await sendAppNotification({
        title: 'استلام وردية (بصمة حضور)',
        message: `حضر (${employee.name}) وأكّد استلام عهدة الدرج في فرع (${branch.name}).`,
        type: 'SHIFT_ACK', 
        target_role: 'OWNER',
        organization_id: orgId,
        link: '/owner/shifts'
      });
    }
  } catch (err) { console.error('Notif Error', err); }

  res.status(200).json({ message: 'تم تأكيد هويتك بنجاح واستلام عهدة الدرج', shift: activeShift });
});

// ==========================================
// 📜 6. سجل الورديات
// ==========================================
const getShiftsHistory = asyncHandler(async (req, res, next) => {
  const branchId = req.user.role === 'CASHIER' ? req.user.branch_id : req.query.branch_id;
  if (!branchId) return next(new AppError('يجب تحديد الفرع', 400));

  if (req.user.role === 'OWNER') await verifyBranchOwnership(branchId, req.user.organization_id);

  const shifts = await Shift.find({ branch_id: branchId, status: 'CLOSED' })
    .populate('cashier_id', 'name')
    .populate('acknowledged_by', 'name')
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json({ count: shifts.length, shifts });
});

// ==========================================
// 🚀 7. بناء التايم لاين (Ultra Optimized O(1) Algorithm 🧠)
// ==========================================
const getShiftTimeline = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const branchId = req.user.role === 'CASHIER' ? req.user.branch_id : req.query.branch_id;

  if (!branchId) return next(new AppError('يجب تحديد الفرع', 400));
  if (req.user.role === 'OWNER') await verifyBranchOwnership(branchId, req.user.organization_id);

  const shift = await Shift.findOne({ _id: id, branch_id: branchId }).lean();
  if (!shift) return next(new AppError('الوردية غير موجودة', 404));

  const endTime = shift.end_time || new Date(); 

  const cashFlows = await CashFlow.find({ shift_id: shift._id })
    .populate('vendor_id', 'name company_name')
    .populate('employee_id', 'name')
    .lean();

  const invoices = await VendorInvoice.find({ branch_id: branchId, createdAt: { $gte: shift.start_time, $lte: endTime }, deleted_at: null })
    .populate('vendor_id', 'name company_name')
    .lean();

  const customerDebts = await CustomerDebt.find({ branch_id: branchId, createdAt: { $gte: shift.start_time, $lte: endTime } })
    .populate('customer_id', 'name')
    .lean();

  // 🧮 [السحر الهندسي]: تجميع الديون لكل الموردين في استعلامين فقط O(1)
  const uniqueVendorIds = [...new Set([
    ...invoices.map(i => i.vendor_id?._id?.toString()),
    ...cashFlows.filter(f => f.type === 'VENDOR_PAYMENT').map(f => f.vendor_id?._id?.toString())
  ])].filter(Boolean);

  const vendorBalances = {};
  
  if (uniqueVendorIds.length > 0) {
    const objectIdVendors = uniqueVendorIds.map(vid => new mongoose.Types.ObjectId(vid));
    const branchShifts = await Shift.find({ branch_id: branchId }).select('_id').lean();
    const shiftIds = branchShifts.map(s => s._id);

    // ضربتين فقط للداتابيز بدلاً من ضربات لا نهائية!
    const [allInvoicesAgg, allPaymentsAgg] = await Promise.all([
      VendorInvoice.aggregate([
        { $match: { branch_id: new mongoose.Types.ObjectId(branchId), vendor_id: { $in: objectIdVendors }, deleted_at: null } },
        { $group: { _id: '$vendor_id', total_remaining: { $sum: '$remaining_amount' } } }
      ]),
      CashFlow.aggregate([
        { $match: { shift_id: { $in: shiftIds }, vendor_id: { $in: objectIdVendors }, type: 'VENDOR_PAYMENT', description: { $not: /^دفعة مستقطعة من فاتورة/ } } },
        { $group: { _id: '$vendor_id', total: { $sum: '$amount' } } }
      ])
    ]);

    // بناء خريطة الأرصدة في الذاكرة
    const invMap = {}; allInvoicesAgg.forEach(i => invMap[i._id.toString()] = i.total_remaining);
    const payMap = {}; allPaymentsAgg.forEach(p => payMap[p._id.toString()] = p.total);

    uniqueVendorIds.forEach(vid => {
      vendorBalances[vid] = (invMap[vid] || 0) - (payMap[vid] || 0);
    });
  }

  // 🧩 تجميع التايم لاين
  let timeline = [];

  cashFlows.forEach((f) => {
    if (f.type === 'INCOME' && f.description && f.description.includes('سداد مديونية')) return; 
    timeline.push({
      _id: f._id, domain: 'CASH', type: f.type, category: f.expense_category, amount: f.amount, description: f.description,
      person_name: f.vendor_id?.name || f.employee_id?.name || 'مصروف عام',
      vendor_balance: f.type === 'VENDOR_PAYMENT' ? vendorBalances[f.vendor_id?._id?.toString()] : undefined, 
      date: f.createdAt,
    });
  });

  invoices.forEach((inv) => {
    timeline.push({
      _id: inv._id, domain: 'INVOICE', amount: inv.total_amount, paid_amount: inv.paid_amount, remaining_amount: inv.remaining_amount,
      invoice_number: inv.invoice_number, image: inv.image_url || null, person_name: inv.vendor_id?.name || 'مورد', company: inv.vendor_id?.company_name || '',
      vendor_balance: vendorBalances[inv.vendor_id?._id?.toString()], 
      date: inv.createdAt,
    });
  });

  customerDebts.forEach((debt) => {
    timeline.push({
      _id: debt._id, domain: 'CUSTOMER_DEBT', type: debt.type, amount: debt.amount, description: debt.notes,
      person_name: debt.customer_id?.name || 'زبون', date: debt.createdAt,
    });
  });

  timeline.sort((a, b) => new Date(b.date) - new Date(a.date));

  res.status(200).json({ count: timeline.length, timeline });
});

module.exports = { openShift, getActiveShift, closeShift, getShiftsHistory, getLastClosedShift, getShiftTimeline, acknowledgeShift };