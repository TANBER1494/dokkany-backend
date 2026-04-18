const Shift = require('../models/Shift');
const VendorInvoice = require('../models/VendorInvoice');
const CashFlow = require('../models/CashFlow');
const CustomerDebt = require('../models/CustomerDebt');
const Product = require('../models/Product');
const Branch = require('../models/Branch');

const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// 👑 1. الداشبورد الشامل للمالك (Ultra Optimized O(1) DB Calls 🚀)
// ==========================================
const getOwnerMasterDashboard = asyncHandler(async (req, res, next) => {
  const orgId = req.user.organization_id;

  // 1. جلب كل فروع المالك ككائنات خفيفة
  const branches = await Branch.find({ organization_id: orgId }).lean();
  if (!branches || branches.length === 0) {
    return res
      .status(200)
      .json({
        grand_totals: {
          total_market_debts_for_us: 0,
          total_market_debts_on_us: 0,
        },
        branches: [],
      });
  }

  const branchIds = branches.map((b) => b._id);

  // 2. 🚀 [الضربة القاضية] استعلامات موحدة لحساب الديون بدقة متناهية
  const [
    openShifts,
    invoicesAgg,
    vendorPaymentsAgg,
    customerDebtsAgg,
    lowStockAgg,
  ] = await Promise.all([
    // أ. جلب كل الورديات المفتوحة لكل الفروع
    Shift.find({ branch_id: { $in: branchIds }, status: 'OPEN' })
      .populate('acknowledged_by', 'name')
      .lean(),
      
    // 🚀 ب. تجميع كل فواتير الموردين (نجمع المتبقي فقط وليس الإجمالي)
    VendorInvoice.aggregate([
      { $match: { branch_id: { $in: branchIds }, deleted_at: null } },
      { $group: { _id: '$branch_id', total_remaining: { $sum: '$remaining_amount' } } },
    ]),
    
    // 🚀 ج. تجميع الدفعات "المستقلة" فقط (نستثني الدفعات التي تمت داخل الفاتورة)
    CashFlow.aggregate([
      { 
        $match: { 
          branch_id: { $in: branchIds }, 
          type: 'VENDOR_PAYMENT',
          description: { $not: /^دفعة مستقطعة من فاتورة/ } 
        } 
      },
      { $group: { _id: '$branch_id', total_independent: { $sum: '$amount' } } },
    ]),
    
    // د. تجميع كل ديون الزبائن مقسمة بالفرع ونوع الحركة (سحب / سداد)
    CustomerDebt.aggregate([
      { $match: { branch_id: { $in: branchIds }, deleted_at: null } },
      {
        $group: {
          _id: { branch: '$branch_id', type: '$type' },
          total: { $sum: '$amount' },
        },
      },
    ]),
    
    // هـ. إحصاء المنتجات النواقص مقسمة بالفرع
    Product.aggregate([
      {
        $match: {
          branch_id: { $in: branchIds },
          deleted_at: null,
          stock_quantity: { $lte: 5 },
        },
      },
      { $group: { _id: '$branch_id', count: { $sum: 1 } } },
    ]),
  ]);

  // 3. جلب حركات الخزينة للورديات المفتوحة فقط لحساب الـ Pulse (النبض الحالي)
  const openShiftIds = openShifts.map((s) => s._id);
  const activeCashFlowsAgg = await CashFlow.aggregate([
    { $match: { shift_id: { $in: openShiftIds } } },
    {
      $group: {
        _id: { shift: '$shift_id', type: '$type' },
        total: { $sum: '$amount' },
      },
    },
  ]);

  // ==========================================
  // 🧠 4. بناء خرائط الذاكرة (Hash Maps) لسرعة الوصول O(1)
  // ==========================================

  // 🚀 خريطة ديون الموردين (المتبقي من الفواتير - الدفعات المستقلة)
  const vendorDebtMap = {};
  invoicesAgg.forEach((inv) => {
    vendorDebtMap[inv._id.toString()] = { remaining: inv.total_remaining, independent_payments: 0 };
  });
  vendorPaymentsAgg.forEach((pay) => {
    if (!vendorDebtMap[pay._id.toString()])
      vendorDebtMap[pay._id.toString()] = { remaining: 0, independent_payments: 0 };
    vendorDebtMap[pay._id.toString()].independent_payments = pay.total_independent;
  });

  // خريطة ديون الزبائن (سحب - سداد)
  const customerDebtMap = {};
  customerDebtsAgg.forEach((debt) => {
    const bId = debt._id.branch.toString();
    if (!customerDebtMap[bId]) customerDebtMap[bId] = { credit: 0, payment: 0 };
    if (debt._id.type === 'CREDIT') customerDebtMap[bId].credit = debt.total;
    if (debt._id.type === 'PAYMENT') customerDebtMap[bId].payment = debt.total;
  });

  // خريطة النواقص
  const lowStockMap = {};
  lowStockAgg.forEach((stock) => {
    lowStockMap[stock._id.toString()] = stock.count;
  });

  // خريطة نبض الدرج للورديات المفتوحة
  const pulseMap = {};
  activeCashFlowsAgg.forEach((cf) => {
    const sId = cf._id.shift.toString();
    if (!pulseMap[sId]) pulseMap[sId] = { income: 0, expenses: 0 };
    if (cf._id.type === 'INCOME') pulseMap[sId].income += cf.total;
    if (cf._id.type === 'EXPENSE' || cf._id.type === 'VENDOR_PAYMENT')
      pulseMap[sId].expenses += cf.total;
  });

  // ==========================================
  // 🧩 5. تجميع البيانات النهائية للفروع
  // ==========================================
  let grandTotalCustomerDebts = 0;
  let grandTotalVendorDebts = 0;

  const branchesData = branches.map((branch) => {
    const bId = branch._id.toString();

    // حساب الوردية إن وجدت
    const shift = openShifts.find((s) => s.branch_id.toString() === bId);
    let shiftDetails = null;
    if (shift) {
      const pulse = pulseMap[shift._id.toString()] || {
        income: 0,
        expenses: 0,
      };
      const currentPulse = shift.starting_cash + pulse.income - pulse.expenses;
      shiftDetails = {
        shift_id: shift._id,
        cashier_name: shift.is_acknowledged
          ? shift.acknowledged_by?.name || 'غير معروف'
          : 'بانتظار استلام الدرج',
        start_time: shift.start_time,
        starting_cash: shift.starting_cash,
        expected_cash: currentPulse,
      };
    }

    // 🚀 حساب الديون الخاص بالموردين (تطبيق المعادلة الذهبية)
    const vDebt = vendorDebtMap[bId] || { remaining: 0, independent_payments: 0 };
    const branchVendorDebts = vDebt.remaining - vDebt.independent_payments;
    grandTotalVendorDebts += branchVendorDebts;

    const cDebt = customerDebtMap[bId] || { credit: 0, payment: 0 };
    const branchCustomerDebts = cDebt.credit - cDebt.payment;
    grandTotalCustomerDebts += branchCustomerDebts;

    // حساب الاشتراك
    let daysLeft = 0;
    const targetDate =
      branch.subscription_status === 'TRIAL'
        ? branch.trial_ends_at
        : branch.subscription_ends_at;
    if (targetDate) {
      const diffTime = Math.ceil(
        (new Date(targetDate) - new Date()) / (1000 * 60 * 60 * 24)
      );
      daysLeft = diffTime > 0 ? diffTime : 0;
    }

    return {
      _id: branch._id,
      name: branch.name,
      status: branch.subscription_status,
      days_left: daysLeft,
      active_shift: shiftDetails,
      debts_for_us: branchCustomerDebts,
      debts_on_us: branchVendorDebts,
      low_stock_count: lowStockMap[bId] || 0,
    };
  });

  res.status(200).json({
    grand_totals: {
      total_market_debts_for_us: grandTotalCustomerDebts,
      total_market_debts_on_us: grandTotalVendorDebts,
    },
    branches: branchesData,
  });
});

module.exports = { getOwnerMasterDashboard };