const Shift = require('../models/Shift');
const CashFlow = require('../models/CashFlow');
const User = require('../models/User');
const mongoose = require('mongoose');

const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// 📊 1. حساب تصفية راتب العامل
// ==========================================
const getEmployeeSettlement = asyncHandler(async (req, res, next) => {
  const { employee_id, month, year } = req.query;
  const orgId = req.user.organization_id;

  if (!employee_id || !month || !year) {
    return next(new AppError('يجب تحديد العامل والشهر والسنة', 400));
  }

  // 🚀 استخدام .lean() لسرعة جلب البيانات
  const employee = await User.findOne({ _id: employee_id, organization_id: orgId }).lean();
  if (!employee) return next(new AppError('العامل غير موجود أو لا يتبع لمؤسستك', 404));

  const dailyWage = employee.daily_wage || 0; 
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59);

  let daysWorked = 0;

  if (employee.employee_title === 'CASHIER') {
    daysWorked = await Shift.countDocuments({
      acknowledged_by: employee_id,
      status: 'CLOSED',
      acknowledged_at: { $gte: startDate, $lte: endDate }
    });
  } else {
    const workStart = employee.start_date ? new Date(employee.start_date) : (employee.createdAt ? new Date(employee.createdAt) : startDate);
    const today = new Date();
    
    const calcEnd = (today < endDate) ? today : endDate;
    const calcStart = (workStart > startDate) ? workStart : startDate;

    if (calcStart <= calcEnd) {
      const diffTime = calcEnd.getTime() - calcStart.getTime();
      daysWorked = Math.ceil(diffTime / (1000 * 3600 * 24));
      if (daysWorked === 0) daysWorked = 1; 
    }
  }

  const totalEarned = daysWorked * dailyWage;

  const advancesAgg = await CashFlow.aggregate([
    { 
      $match: { 
        employee_id: new mongoose.Types.ObjectId(employee_id),
        type: 'EXPENSE',
        expense_category: 'PERSONAL',
        createdAt: { $gte: startDate, $lte: endDate }
      } 
    },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);

  const totalAdvances = advancesAgg.length > 0 ? advancesAgg[0].total : 0;

  const advancesHistory = await CashFlow.find({
    employee_id: employee_id,
    type: 'EXPENSE',
    expense_category: 'PERSONAL',
    createdAt: { $gte: startDate, $lte: endDate }
  }).sort({ createdAt: -1 }).select('amount description createdAt').lean();

  const remainingSalary = totalEarned - totalAdvances;

  res.status(200).json({
    employee_name: employee.name,
    month,
    year,
    summary: {
      days_worked: daysWorked,
      daily_wage: dailyWage,
      total_earned: totalEarned,
      total_advances: totalAdvances,
      remaining_salary: remainingSalary
    },
    history: advancesHistory 
  });
});

// ==========================================
// 💸 2. صرف مرتب وخصمه من الخزينة (مع حماية صارمة)
// ==========================================
const payEmployeeSettlement = asyncHandler(async (req, res, next) => {
  const { employee_id, month, year, amount_to_pay, notes } = req.body;
  const branchId = req.user.branch_id; 
  const orgId = req.user.organization_id;

  // 🛡️ الحماية من الأرقام السالبة أو الحروف
  const numAmount = Number(amount_to_pay);
  if (isNaN(numAmount) || numAmount <= 0) {
    return next(new AppError('يجب إدخال مبلغ صحيح أكبر من الصفر', 400));
  }

  // 🛡️ [Tenant Isolation] التأكد أن العامل يتبع لنفس مؤسسة الكاشير
  const employeeExists = await User.exists({ _id: employee_id, organization_id: orgId });
  if (!employeeExists) {
    return next(new AppError('هذا العامل غير موجود في مؤسستك!', 403));
  }

  const activeShift = await Shift.findOne({ branch_id: branchId, status: 'OPEN' }).lean();
  if (!activeShift) return next(new AppError('لا يمكن صرف مرتب، لا توجد وردية مفتوحة حالياً', 403));

  const settlementRecord = await CashFlow.create({
    shift_id: activeShift._id,
    type: 'EXPENSE',
    expense_category: 'PERSONAL', 
    amount: numAmount,
    description: `تصفية راتب شهر ${month}/${year}: ${notes ? notes.trim() : ''}`,
    employee_id: employee_id,
    branch_id: branchId, // 👈 للتأكد من حفظ الحركة في الفرع الصحيح
    organization_id: orgId
  });

  res.status(201).json({
    message: 'تم تسجيل صرف المرتب وخصمه من الخزينة بنجاح',
    settlement: settlementRecord
  });
});

module.exports = { getEmployeeSettlement, payEmployeeSettlement };