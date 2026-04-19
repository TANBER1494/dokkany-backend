const mongoose = require('mongoose');
const Vendor = require('../models/Vendor');
const Branch = require('../models/Branch');
const VendorInvoice = require('../models/VendorInvoice');
const CashFlow = require('../models/CashFlow');
const Shift = require('../models/Shift');

const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// ➕ 1. إضافة مورد جديد
// ==========================================
const addVendor = asyncHandler(async (req, res, next) => {
  const { name, company_name, phone, address } = req.body;
  const branchId = req.user.role === 'CASHIER' ? req.user.branch_id : req.body.branch_id;
  const orgId = req.user.organization_id;

  if (!name || !branchId) {
    return next(new AppError('اسم المندوب والفرع بيانات مطلوبة', 400));
  }

  const existingVendor = await Vendor.exists({ branch_id: branchId, name: name.trim(), deleted_at: null });
  if (existingVendor) {
    return next(new AppError('هذا المورد مسجل بالفعل في قائمة هذا الفرع', 400));
  }

  const newVendor = await Vendor.create({
    organization_id: orgId,
    branch_id: branchId,
    name: name.trim(),
    company_name: company_name ? company_name.trim() : null,
    phone: phone ? phone.trim() : null,
    address: address ? address.trim() : null,
  });

  res.status(201).json({ message: 'تم إضافة المورد لقائمة الفرع بنجاح', vendor: newVendor });
});

// ==========================================
// 📋 2. جلب موردين فرع محدد (مع حساب إجمالي الديون للنشطين) - 🚀 جراحة محاسبية
// ==========================================
// ==========================================
// 📋 2. جلب موردين فرع محدد (مقاوم لأخطاء قواعد البيانات 🚀)
// ==========================================
const getVendors = asyncHandler(async (req, res, next) => {
  const branchId = req.user.role === 'CASHIER' ? req.user.branch_id : req.query.branch_id;
  if (!branchId) return next(new AppError('يجب تحديد الفرع', 400));

  const vendors = await Vendor.find({ branch_id: branchId, deleted_at: null }).sort({ createdAt: -1 }).lean();
  const activeVendorIds = vendors.map(v => v._id);

  let total_debt = 0;

  if (activeVendorIds.length > 0) {
    // 🚀 الجراحة الدقيقة: حذفنا branch_id تماماً من هنا، واعتمدنا على الموردين فقط!
    const [invoices, independentPayments] = await Promise.all([
      VendorInvoice.find({ 
        vendor_id: { $in: activeVendorIds }, // 👈 السر هنا
        deleted_at: null 
      }).select('vendor_id remaining_amount').lean(),
      
      CashFlow.find({ 
        vendor_id: { $in: activeVendorIds }, // 👈 والسر هنا
        type: 'VENDOR_PAYMENT', 
        description: { $not: /^دفعة مستقطعة من فاتورة/ } 
      }).select('vendor_id amount').lean()
    ]);

    const invoiceMap = {};
    invoices.forEach(inv => {
      const vId = inv.vendor_id.toString();
      invoiceMap[vId] = (invoiceMap[vId] || 0) + inv.remaining_amount;
    });

    const paymentMap = {};
    independentPayments.forEach(pay => {
      const vId = pay.vendor_id.toString();
      paymentMap[vId] = (paymentMap[vId] || 0) + pay.amount;
    });

    vendors.forEach(vendor => {
      const vId = vendor._id.toString();
      const remainingFromInvoices = invoiceMap[vId] || 0;
      const independentPaid = paymentMap[vId] || 0;

      // 🚀 المعادلة الذهبية ستعمل الآن بامتياز
      vendor.total_due = remainingFromInvoices - independentPaid;
      total_debt += vendor.total_due;
    });
  }

  res.status(200).json({ vendors, total_debt });
});

// ==========================================
// ✏️ 3. تعديل بيانات مورد
// ==========================================
const updateVendor = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name, company_name, phone, address } = req.body;
  const orgId = req.user.organization_id;

  const vendor = await Vendor.findOne({ _id: id, organization_id: orgId, deleted_at: null });
  if (!vendor) return next(new AppError('المورد غير موجود أو لا تملك صلاحية تعديله', 404));

  if (name) vendor.name = name.trim();
  if (company_name !== undefined) vendor.company_name = company_name.trim();
  if (phone !== undefined) vendor.phone = phone.trim();
  if (address !== undefined) vendor.address = address.trim();

  await vendor.save();
  res.status(200).json({ message: 'تم تحديث بيانات المورد بنجاح', vendor });
});

// ==========================================
// 🗑️ 4. حذف مورد (Soft Delete)
// ==========================================
const deleteVendor = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const orgId = req.user.organization_id;

  const vendor = await Vendor.findOneAndUpdate(
    { _id: id, organization_id: orgId, deleted_at: null },
    { deleted_at: new Date() },
    { new: true }
  );

  if (!vendor) return next(new AppError('المورد غير موجود', 404));
  res.status(200).json({ message: 'تم إزالة المورد بنجاح' });
});

module.exports = { addVendor, getVendors, updateVendor, deleteVendor };