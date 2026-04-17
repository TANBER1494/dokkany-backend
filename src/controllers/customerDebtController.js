const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const CustomerDebt = require('../models/CustomerDebt');
const Shift = require('../models/Shift');
const CashFlow = require('../models/CashFlow');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// 📋 1. جلب قائمة الزبائن والمديونيات (Optimized O(N) Algorithm) 🚀
// ==========================================
const getCustomersList = asyncHandler(async (req, res, next) => {
  const branchId =
    req.user.role === 'CASHIER' ? req.user.branch_id : req.query.branch_id;
  const orgId = req.user.organization_id;

  if (!branchId) return next(new AppError('يجب تحديد الفرع', 400));

  // جلب البيانات ككائنات خفيفة وسريعة جداً
  const customers = await Customer.find({
    organization_id: orgId,
    branch_id: branchId,
    deleted_at: null,
  })
    .sort({ createdAt: -1 })
    .lean();

  const debts = await CustomerDebt.find({
    branch_id: branchId,
    deleted_at: null,
  }).lean();

  // 🧠 [Senior Move]: خريطة ذاكرة (Hash Map) لحساب الديون في جزء من الثانية (O(N)) بدلاً من (O(N^2))
  const debtMap = {};
  debts.forEach((d) => {
    const cid = d.customer_id.toString();
    if (!debtMap[cid]) debtMap[cid] = { credit: 0, payment: 0 };
    if (d.type === 'CREDIT') debtMap[cid].credit += d.amount;
    if (d.type === 'PAYMENT') debtMap[cid].payment += d.amount;
  });

  const customersWithBalances = customers.map((customer) => {
    const balance = debtMap[customer._id.toString()] || {
      credit: 0,
      payment: 0,
    };
    return {
      _id: customer._id,
      name: customer.name,
      phone: customer.phone,
      net_debt: balance.credit - balance.payment,
    };
  });

  res.status(200).json({ customers: customersWithBalances });
});

// ==========================================
// ➕ 2. فتح حساب شكك مع إضافة أول مديونية (ACID Transaction) 🛡️
// ==========================================
const addCustomerWithInitialDebt = asyncHandler(async (req, res, next) => {
  const { name, phone, initial_amount, notes } = req.body;
  const branchId = req.user.branch_id;
  const orgId = req.user.organization_id;

  const numAmount = Number(initial_amount);
  if (!name || isNaN(numAmount) || numAmount <= 0) {
    return next(
      new AppError('اسم الزبون وأول مبلغ دين صحيح (أكبر من صفر) مطلوبان', 400)
    );
  }

  const activeShift = await Shift.findOne({
    branch_id: branchId,
    status: 'OPEN',
  }).lean();
  if (!activeShift) {
    return next(
      new AppError('لا يمكن فتح حساب شكك وتسجيل بضاعة بدون وردية مفتوحة', 403)
    );
  }

  const existing = await Customer.exists({
    name: name.trim(),
    organization_id: orgId,
    branch_id: branchId,
    deleted_at: null,
  });
  if (existing) {
    return next(
      new AppError(
        'هذا الزبون مسجل بالفعل في هذا الفرع، ابحث عن اسمه وأضف الدين لحسابه',
        400
      )
    );
  }

  // 🛡️ بدء الـ Transaction لحماية العملية المزدوجة
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const [customer] = await Customer.create(
      [
        {
          organization_id: orgId,
          branch_id: branchId,
          name: name.trim(),
          phone: phone || null,
        },
      ],
      { session }
    );

    await CustomerDebt.create(
      [
        {
          branch_id: branchId,
          customer_id: customer._id,
          shift_id: activeShift._id,
          type: 'CREDIT',
          amount: numAmount,
          notes: notes ? notes.trim() : 'رصيد افتتاحي (أول سحبة شكك)',
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    res
      .status(201)
      .json({ message: 'تم فتح الحساب وتسجيل أول مديونية بنجاح', customer });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return next(
      new AppError(
        'خطأ داخلي أثناء تسجيل الزبون والمديونية، تم التراجع لحماية البيانات',
        500
      )
    );
  }
});

// ==========================================
// 📝 3. تسجيل حركة سحب أو سداد (ACID Transaction) 🛡️
// ==========================================
const recordTransaction = asyncHandler(async (req, res, next) => {
  const { customer_id, type, amount, notes } = req.body;
  const branchId = req.user.branch_id;

  const numAmount = Number(amount);
  if (!customer_id || !type || isNaN(numAmount) || numAmount <= 0) {
    return next(
      new AppError('بيانات الحركة غير مكتملة أو المبلغ غير صحيح', 400)
    );
  }

  const activeShift = await Shift.findOne({
    branch_id: branchId,
    status: 'OPEN',
  }).lean();
  if (!activeShift)
    return next(new AppError('لا يوجد وردية مفتوحة حالياً', 403));

  const customer = await Customer.findOne({
    _id: customer_id,
    branch_id: branchId,
    organization_id: req.user.organization_id,
  }).lean();
  if (!customer)
    return next(new AppError('الزبون غير موجود في هذا الفرع', 404));

  // 🛡️ بدء الـ Transaction لحماية ربط الديون بخزينة الدرج
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const [debtRecord] = await CustomerDebt.create(
      [
        {
          branch_id: branchId,
          customer_id,
          shift_id: activeShift._id,
          type,
          amount: numAmount,
          notes: notes
            ? notes.trim()
            : type === 'CREDIT'
              ? 'سحب بضاعة'
              : 'سداد نقدي',
        },
      ],
      { session }
    );

    if (type === 'PAYMENT') {
      await CashFlow.create(
        [
          {
            shift_id: activeShift._id,
            type: 'INCOME',
            amount: numAmount,
            description: `سداد مديونية من الزبون: ${customer.name}`,
            branch_id: branchId,
            organization_id: req.user.organization_id,
          },
        ],
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      message:
        type === 'CREDIT'
          ? 'تم تسجيل البضاعة في الكشكول'
          : 'تم استلام المبلغ ودخل عهدة الدرج',
      transaction: debtRecord,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return next(
      new AppError(
        'حدث خطأ أثناء تسجيل الحركة المالية، تم التراجع لحفظ أمان الخزينة',
        500
      )
    );
  }
});

// ==========================================
// 📊 4. كشف حساب زبون التفصيلي
// ==========================================
const getCustomerStatement = asyncHandler(async (req, res, next) => {
  const { customer_id } = req.params;
  const branchId =
    req.user.role === 'CASHIER' ? req.user.branch_id : req.query.branch_id;

  if (!branchId) return next(new AppError('يجب تحديد الفرع', 400));

  const customer = await Customer.findOne({
    _id: customer_id,
    branch_id: branchId,
    organization_id: req.user.organization_id,
  }).lean();
  if (!customer)
    return next(new AppError('الزبون غير موجود في هذا الفرع', 404));

  const transactions = await CustomerDebt.find({
    customer_id,
    branch_id: branchId,
    deleted_at: null,
  })
    .sort({ createdAt: -1 })
    .lean();

  let totalCredit = 0;
  let totalPayment = 0;

  const history = transactions.map((t) => {
    if (t.type === 'CREDIT') totalCredit += t.amount;
    if (t.type === 'PAYMENT') totalPayment += t.amount;
    return {
      id: t._id,
      type: t.type,
      amount: t.amount,
      notes: t.notes,
      date: t.createdAt,
    };
  });

  res.status(200).json({
    customer_info: {
      id: customer._id,
      name: customer.name,
      phone: customer.phone,
      net_debt: totalCredit - totalPayment,
    },
    history,
  });
});

// ==========================================
// 🔄 5. تعديل بيانات الزبون
// ==========================================
const updateCustomer = asyncHandler(async (req, res, next) => {
  const { customer_id } = req.params;
  const { name, phone } = req.body;
  const branchId = req.user.role === 'CASHIER' ? req.user.branch_id : req.query.branch_id;

  if (!name) return next(new AppError('اسم الزبون مطلوب', 400));

  const customer = await Customer.findOneAndUpdate(
    { 
      _id: customer_id, 
      branch_id: branchId, 
      organization_id: req.user.organization_id, 
      deleted_at: null 
    },
    { 
      name: name.trim(), 
      phone: phone || null 
    },
    { new: true, runValidators: true }
  );

  if (!customer) return next(new AppError('الزبون غير موجود أو تم حذفه مسبقاً', 404));

  res.status(200).json({ message: 'تم تحديث بيانات الزبون بنجاح', customer });
});

// ==========================================
// 🗑️ 6. حذف الزبون (Soft Delete) 🛡️
// ==========================================
const deleteCustomer = asyncHandler(async (req, res, next) => {
  const { customer_id } = req.params;
  const branchId = req.user.role === 'CASHIER' ? req.user.branch_id : req.query.branch_id;

  // نقوم بعمل Soft Delete للحفاظ على سلامة العمليات السابقة في الداتا بيز
  const customer = await Customer.findOneAndUpdate(
    { 
      _id: customer_id, 
      branch_id: branchId, 
      organization_id: req.user.organization_id, 
      deleted_at: null 
    },
    { deleted_at: new Date() },
    { new: true }
  );

  if (!customer) return next(new AppError('الزبون غير موجود أو تم حذفه مسبقاً', 404));

  res.status(200).json({ message: 'تم مسح الزبون من الدفتر بنجاح' });
});

module.exports = {
  getCustomersList,
  addCustomerWithInitialDebt,
  recordTransaction,
  getCustomerStatement,
  updateCustomer,
  deleteCustomer,
};
