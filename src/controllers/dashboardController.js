const Shift = require('../models/Shift');
const VendorInvoice = require('../models/VendorInvoice');
const CashFlow = require('../models/CashFlow');
const CustomerDebt = require('../models/CustomerDebt');
const Product = require('../models/Product');
const Branch = require('../models/Branch');
const Vendor = require('../models/Vendor');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// 👑 1. الداشبورد الشامل للمالك (Bulletproof Routing 🚀)
// ==========================================
const getOwnerMasterDashboard = asyncHandler(async (req, res, next) => {
  const orgId = req.user.organization_id;

  const branches = await Branch.find({ organization_id: orgId }).lean();
  if (!branches || branches.length === 0) {
    return res.status(200).json({ grand_totals: { total_market_debts_for_us: 0, total_market_debts_on_us: 0 }, branches: [] });
  }

  const branchIds = branches.map((b) => b._id);

  // 🚀 1. جلب كل الموردين لعمل "خريطة توجيه" (Vendor -> Branch)
  const vendors = await Vendor.find({ organization_id: orgId, deleted_at: null }).select('_id branch_id').lean();
  const vendorIds = vendors.map(v => v._id);
  const vendorToBranchMap = {};
  vendors.forEach(v => { vendorToBranchMap[v._id.toString()] = v.branch_id.toString(); });

  // 🚀 2. جلب المدفوعات بدلالة الموردين لتجنب أخطاء branch_id
  const [
    openShifts,
    allInvoices,
    allIndependentPayments,
    customerDebts,
    products
  ] = await Promise.all([
    Shift.find({ branch_id: { $in: branchIds }, status: 'OPEN' }).populate('acknowledged_by', 'name').lean(),
    VendorInvoice.find({ branch_id: { $in: branchIds }, deleted_at: null }).select('branch_id remaining_amount').lean(),
    
    // 🔥 البحث بالمورد وليس بالفرع!
    CashFlow.find({ vendor_id: { $in: vendorIds }, type: 'VENDOR_PAYMENT', description: { $not: /^دفعة مستقطعة من فاتورة/ } }).select('vendor_id amount').lean(),
    
    CustomerDebt.find({ branch_id: { $in: branchIds }, deleted_at: null }).select('branch_id type amount').lean(),
    Product.find({ branch_id: { $in: branchIds }, deleted_at: null, stock_quantity: { $lte: 5 } }).select('branch_id').lean()
  ]);

  const openShiftIds = openShifts.map((s) => s._id);
  const activeCashFlows = await CashFlow.find({ shift_id: { $in: openShiftIds } }).select('shift_id type amount').lean();

  // ==========================================
  // 🧠 4. تجميع الديون عبر خريطة الذاكرة الموجهة
  // ==========================================
  const vendorDebtMap = {};

  allInvoices.forEach((inv) => {
    const bId = inv.branch_id.toString();
    if (!vendorDebtMap[bId]) vendorDebtMap[bId] = 0;
    vendorDebtMap[bId] += inv.remaining_amount; // إضافة الفواتير
  });

  allIndependentPayments.forEach((pay) => {
    // 🔥 توجيه الدفعة لفرعها الصحيح بناءً على المورد!
    const vId = pay.vendor_id?.toString();
    const bId = vendorToBranchMap[vId]; 
    if (bId) {
      if (!vendorDebtMap[bId]) vendorDebtMap[bId] = 0;
      vendorDebtMap[bId] -= pay.amount; // خصم المدفوعات المستقلة
    }
  });

  const customerDebtMap = {};
  customerDebts.forEach((debt) => {
    const bId = debt.branch_id.toString();
    if (!customerDebtMap[bId]) customerDebtMap[bId] = { credit: 0, payment: 0 };
    if (debt.type === 'CREDIT') customerDebtMap[bId].credit += debt.amount;
    if (debt.type === 'PAYMENT') customerDebtMap[bId].payment += debt.amount;
  });

  const lowStockMap = {};
  products.forEach((stock) => {
    const bId = stock.branch_id.toString();
    lowStockMap[bId] = (lowStockMap[bId] || 0) + 1;
  });

  const pulseMap = {};
  activeCashFlows.forEach((cf) => {
    const sId = cf.shift_id.toString();
    if (!pulseMap[sId]) pulseMap[sId] = { income: 0, expenses: 0 };
    if (cf.type === 'INCOME') pulseMap[sId].income += cf.amount;
    if (cf.type === 'EXPENSE' || cf.type === 'VENDOR_PAYMENT') pulseMap[sId].expenses += cf.amount;
  });

  // ==========================================
  // 🧩 5. تجميع البيانات النهائية
  // ==========================================
  let grandTotalCustomerDebts = 0;
  let grandTotalVendorDebts = 0;

  const branchesData = branches.map((branch) => {
    const bId = branch._id.toString();

    const shift = openShifts.find((s) => s.branch_id.toString() === bId);
    let shiftDetails = null;
    if (shift) {
      const pulse = pulseMap[shift._id.toString()] || { income: 0, expenses: 0 };
      const currentPulse = shift.starting_cash + pulse.income - pulse.expenses;
      shiftDetails = {
        shift_id: shift._id,
        cashier_name: shift.is_acknowledged ? shift.acknowledged_by?.name || 'غير معروف' : 'بانتظار استلام الدرج',
        start_time: shift.start_time,
        starting_cash: shift.starting_cash,
        expected_cash: currentPulse,
      };
    }

    // 🚀 تطبيق الدين النهائي السليم
    const branchVendorDebts = vendorDebtMap[bId] || 0;
    grandTotalVendorDebts += branchVendorDebts;

    const cDebt = customerDebtMap[bId] || { credit: 0, payment: 0 };
    const branchCustomerDebts = cDebt.credit - cDebt.payment;
    grandTotalCustomerDebts += branchCustomerDebts;

    let daysLeft = 0;
    const targetDate = branch.subscription_status === 'TRIAL' ? branch.trial_ends_at : branch.subscription_ends_at;
    if (targetDate) {
      const diffTime = Math.ceil((new Date(targetDate) - new Date()) / (1000 * 60 * 60 * 24));
      daysLeft = diffTime > 0 ? diffTime : 0;
    }

    return {
      _id: branch._id,
      name: branch.name,
      status: branch.subscription_status,
      days_left: daysLeft,
      active_shift: shiftDetails,
      debts_for_us: branchCustomerDebts,
      debts_on_us: branchVendorDebts, // 👈 الرقم الموثوق
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
