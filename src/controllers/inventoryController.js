const mongoose = require('mongoose');
const InventoryCount = require('../models/InventoryCount');
const Product = require('../models/Product');
const VendorInvoice = require('../models/VendorInvoice');
const CashFlow = require('../models/CashFlow');
const Shift = require('../models/Shift');
const CustomerDebt = require('../models/CustomerDebt');

const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// 🚀 تنفيذ عملية جرد شاملة (Optimized & ACID Transactional)
// ==========================================
const performInventory = asyncHandler(async (req, res, next) => {
  const { branch_id, counted_items, actual_cash, previous_capital, fixed_expenses, notes } = req.body;
  const ownerOrgId = req.user.organization_id;

  if (!branch_id || !Array.isArray(counted_items) || counted_items.length === 0) {
    return next(new AppError('بيانات الجرد غير مكتملة أو لا توجد منتجات', 400));
  }

  // 1. جلب كل المنتجات المجرودة بـ "ضربة واحدة" (O(1) Database Call)
  const productIds = counted_items.map(item => item.product_id);
  const productsInDb = await Product.find({ _id: { $in: productIds }, branch_id: branch_id, deleted_at: null }).lean();

  if (productsInDb.length === 0) {
    return next(new AppError('لم يتم العثور على المنتجات في قاعدة البيانات', 404));
  }

  // 🧠 بناء Hash Map للمنتجات للوصول السريع
  const productsMap = {};
  productsInDb.forEach(p => { productsMap[p._id.toString()] = p; });

  let totalStockPurchase = 0;
  let totalStockSelling = 0;
  const finalItems = [];
  const bulkUpdateOps = []; // 🚀 مصفوفة التحديث الجماعي

  // 2. معالجة البيانات في الذاكرة (سريع جداً ولا يضغط على الداتابيز)
  for (let item of counted_items) {
    const product = productsMap[item.product_id];
    if (product) {
      const quantity = Number(item.quantity) >= 0 ? Number(item.quantity) : 0; // حماية من الأرقام السالبة
      
      totalStockPurchase += product.purchase_price * quantity;
      totalStockSelling += product.selling_price * quantity;

      finalItems.push({
        product_id: product._id,
        product_name: product.name,
        quantity_found: quantity,
        purchase_price_at_time: product.purchase_price,
        selling_price_at_time: product.selling_price,
      });

      // تجهيز أمر التحديث للمخزن
      bulkUpdateOps.push({
        updateOne: {
          filter: { _id: product._id },
          update: { stock_quantity: quantity }
        }
      });
    }
  }

  // 3. 🧮 حساب ديون الموردين والزبائن (باستخدام التوازي - Parallel Execution)
  const [invoicesTotal, paymentsTotal, customerDebtsAgg] = await Promise.all([
    VendorInvoice.aggregate([
      { $match: { branch_id: new mongoose.Types.ObjectId(branch_id), deleted_at: null } },
      { $group: { _id: null, total: { $sum: '$total_amount' } } }
    ]),
    // جلب مدفوعات الموردين المرتبطة بهذا الفرع
    CashFlow.aggregate([
      { $match: { branch_id: new mongoose.Types.ObjectId(branch_id), type: 'VENDOR_PAYMENT' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]),
    CustomerDebt.aggregate([
      { $match: { branch_id: new mongoose.Types.ObjectId(branch_id), deleted_at: null } },
      { $group: { _id: '$type', total: { $sum: '$amount' } } }
    ])
  ]);

  const vendorDebts = (invoicesTotal[0]?.total || 0) - (paymentsTotal[0]?.total || 0);
  
  let totalCustomerDebts = 0;
  customerDebtsAgg.forEach(t => {
    if (t._id === 'CREDIT') totalCustomerDebts += t.total;
    if (t._id === 'PAYMENT') totalCustomerDebts -= t.total;
  });

  // 4. 📈 الحسابات الختامية
  const netValue = totalStockPurchase + (Number(actual_cash) || 0) + totalCustomerDebts - (vendorDebts + (Number(fixed_expenses) || 0));
  const baseCapital = Number(previous_capital) || 0;
  const netProfit = netValue - baseCapital;

  // 5. 🛡️ الـ Transaction (أما أن ينجح كل شيء، أو نتراجع عن كل شيء)
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // تحديث كل أرصدة المنتجات في قاعدة البيانات بضربة واحدة! 🚀
    if (bulkUpdateOps.length > 0) {
      await Product.bulkWrite(bulkUpdateOps, { session });
    }

    // حفظ سجل الجرد
    const [inventoryRecord] = await InventoryCount.create([{
      branch_id,
      performed_by: req.user._id,
      items: finalItems,
      total_stock_purchase_value: totalStockPurchase,
      total_stock_selling_value: totalStockSelling,
      actual_cash: Number(actual_cash) || 0,
      total_vendor_debts: vendorDebts,
      total_customer_debts: totalCustomerDebts,
      fixed_expenses: Number(fixed_expenses) || 0,
      previous_capital: baseCapital, 
      net_store_value: netValue,
      net_profit: netProfit,         
      notes: notes ? notes.trim() : '',
    }], { session });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      message: 'تمت عملية الجرد وتحديث الأرصدة وحساب الأرباح بنجاح',
      summary: {
        _id: inventoryRecord._id,
        createdAt: inventoryRecord.createdAt,
        stock_value: totalStockPurchase,
        actual_cash: inventoryRecord.actual_cash,
        debts_on_us: vendorDebts,
        debts_for_us: totalCustomerDebts,
        expenses: inventoryRecord.fixed_expenses,
        previous_capital: baseCapital,
        net_wealth: netValue,
        net_profit: netProfit,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Inventory Transaction Error:', error);
    return next(new AppError('حدث خطأ أثناء حفظ الجرد وتحديث المخزن، تم التراجع لحماية البيانات', 500));
  }
});

// ==========================================
// 📋 جلب أرشيف الجرد
// ==========================================
const getInventoryHistory = asyncHandler(async (req, res, next) => {
  const { branch_id } = req.query;
  if (!branch_id) return next(new AppError('يجب تحديد الفرع', 400));

  const history = await InventoryCount.find({ branch_id })
    .populate('performed_by', 'name role')
    .sort({ createdAt: -1 })
    .lean(); // 🚀 للسرعة
    
  res.status(200).json(history);
});

module.exports = { performInventory, getInventoryHistory };