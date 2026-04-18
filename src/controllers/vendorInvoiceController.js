const mongoose = require('mongoose');
const VendorInvoice = require('../models/VendorInvoice');
const Vendor = require('../models/Vendor');
const Branch = require('../models/Branch');
const CashFlow = require('../models/CashFlow');
const Shift = require('../models/Shift');
const User = require('../models/User');
const Notification = require('../models/Notification');
const socket = require('../models/socket');

const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// 📝 1. تسجيل فاتورة مشتريات جديدة (ACID Transaction 🛡️)
// ==========================================
const addInvoice = asyncHandler(async (req, res, next) => {
  const { branch_id, vendor_id, total_amount, paid_amount, invoice_number, notes } = req.body;
  const image_url = req.file ? req.file.path : null;
  const orgId = req.user.organization_id;

  const numTotal = Number(total_amount);
  const numPaid = Number(paid_amount) || 0;

  if (!branch_id || !vendor_id || isNaN(numTotal) || numTotal <= 0 || numPaid < 0) {
    return next(new AppError('بيانات الفاتورة غير صحيحة، تأكد من إدخال أرقام موجبة', 400));
  }
  if (numPaid > numTotal) {
    return next(new AppError('المبلغ المدفوع لا يمكن أن يكون أكبر من إجمالي الفاتورة', 400));
  }

  const branch = await Branch.findOne({ _id: branch_id, organization_id: orgId }).lean();
  if (!branch) return next(new AppError('الفرع غير صالح', 403));

  const vendor = await Vendor.findOne({ _id: vendor_id, organization_id: orgId, deleted_at: null }).lean();
  if (!vendor) return next(new AppError('المورد المحدد غير موجود', 404));

  let activeShift = null;
  if (numPaid > 0) {
    activeShift = await Shift.findOne({ branch_id, status: 'OPEN' }).lean();
    if (!activeShift) return next(new AppError('لا يوجد وردية مفتوحة حالياً لخصم الدفعة النقدية من الدرج!', 403));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const [newInvoice] = await VendorInvoice.create([{
      branch_id,
      vendor_id,
      entered_by: req.user._id,
      total_amount: numTotal,
      paid_amount: numPaid,
      remaining_amount: numTotal - numPaid,
      invoice_number: invoice_number ? invoice_number.trim() : null,
      notes: notes ? notes.trim() : null,
      image_url: image_url || null
    }], { session });

    if (numPaid > 0) {
      await CashFlow.create([{
        shift_id: activeShift._id,
        type: 'VENDOR_PAYMENT',
        amount: numPaid,
        description: `دفعة مستقطعة من فاتورة رقم: ${invoice_number || newInvoice._id.toString().slice(-4)}`,
        
        // 🚀 التعديل هنا: استخدم المتغيرات التي تحتوي على _id الصريح
        vendor_id: vendor._id, 
        branch_id: branch._id, 
        organization_id: orgId
      }], { session });
    }

    await session.commitTransaction();
    session.endSession();

    try {
      const owner = await User.findOne({ organization_id: orgId, role: 'OWNER' }).select('notifications').lean();
      if (owner?.notifications?.new_invoice !== false) {
        const notification = await Notification.create({
          organization_id: orgId, branch_id: branch._id, target_role: 'OWNER', title: 'فاتورة مورد جديدة',
          message: `تم استلام بضاعة من (${vendor.name}) بقيمة ${numTotal} ج.م في (${branch.name}).`,
          type: 'INVOICE', link: '/owner/shifts'
        });
        socket.getIO().to(orgId.toString()).emit('new_notification', notification);
      }
    } catch (err) { console.error(err); }

    res.status(201).json({
      message: numPaid > 0 ? 'تم تسجيل الفاتورة وخصم الدفعة من الدرج بنجاح' : 'تم تسجيل الفاتورة كمديونية آجلة',
      invoice: newInvoice
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return next(new AppError('حدث خطأ أثناء حفظ الفاتورة بالخزينة، تم التراجع لحماية البيانات', 500));
  }
});

// ==========================================
// 🗑️ 2. حذف فاتورة (مع حماية الورديات المغلقة)
// ==========================================
const deleteInvoice = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const invoice = await VendorInvoice.findOne({ _id: id, deleted_at: null }).populate('vendor_id', 'name');
  if (!invoice) return next(new AppError('الفاتورة غير موجودة', 404));

  const branch = await Branch.findById(invoice.branch_id);
  if (!branch) return next(new AppError('الفرع غير موجود', 404));

  if (req.user.role === 'CASHIER') {
    const diffInMinutes = (new Date() - new Date(invoice.createdAt)) / (1000 * 60);
    const isTimeExpired = diffInMinutes > branch.deletion_window_minutes;

    if (isTimeExpired && branch.is_deletion_allowed === false) {
      return next(new AppError(`انتهت مهلة التعديل (${branch.deletion_window_minutes} دقيقة). يرجى الاتصال بالمالك.`, 403));
    }
  }

  let oldCashFlow = null;
  if (invoice.paid_amount > 0) {
    oldCashFlow = await CashFlow.findOne({
      vendor_id: invoice.vendor_id._id,
      type: 'VENDOR_PAYMENT',
      branch_id: invoice.branch_id,
      createdAt: { $gte: new Date(invoice.createdAt.getTime() - 60000), $lte: new Date(invoice.createdAt.getTime() + 60000) }
    }).populate('shift_id');

    if (oldCashFlow && oldCashFlow.shift_id && oldCashFlow.shift_id.status === 'CLOSED') {
      return next(new AppError('❌ لا يمكن حذف هذه الفاتورة لأن الدفعة النقدية المرتبطة بها تم توريدها في وردية مغلقة. قم بعمل فاتورة مرتجع بدلاً من المسح.', 403));
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    invoice.deleted_at = new Date();
    await invoice.save({ session });

    if (oldCashFlow) {
      await CashFlow.findByIdAndDelete(oldCashFlow._id, { session });
    }

    await session.commitTransaction();
    session.endSession();
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return next(new AppError('فشل التراجع عن الفاتورة', 500));
  }

  // 🔔 إشعار الحذف (تم إزالة شرط الكاشير ليعمل دائماً)
  try {
    const owner = await User.findOne({ organization_id: branch.organization_id, role: 'OWNER' }).select('notifications').lean();
    if (!owner || owner.notifications?.invoice_deleted !== false) {
      const senderName = req.user.name || 'مستخدم بالنظام';
      const notification = await Notification.create({
        organization_id: branch.organization_id,
        branch_id: branch._id,
        target_role: 'OWNER',
        title: 'تنبيه: تم التراجع عن فاتورة 🗑️',
        message: `قام (${senderName}) بمسح فاتورة للمورد (${invoice.vendor_id?.name || 'مجهول'}) بقيمة ${invoice.total_amount} ج.م في فرع (${branch.name}).`,
        type: 'SYSTEM',
        link: '/owner/shifts'
      });
      socket.getIO().to(branch.organization_id.toString()).emit('new_notification', notification);
    }
  } catch (notifErr) { console.error('Audit Notification Error:', notifErr); }

  res.status(200).json({ message: 'تم التراجع عن الفاتورة والمبالغ المرتبطة بها بنجاح' });
});

// ==========================================
// ✏️ 3. تعديل فاتورة مسجلة (الصارمة جداً 🛡️)
// ==========================================
const updateInvoice = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { total_amount, paid_amount, invoice_number, notes } = req.body;
  const image_url = req.file ? req.file.path : undefined;

  const invoice = await VendorInvoice.findOne({ _id: id, deleted_at: null }).populate('vendor_id', 'name');
  if (!invoice) return next(new AppError('الفاتورة غير موجودة', 404));

  const branch = await Branch.findById(invoice.branch_id);

  if (req.user.role === 'CASHIER') {
    const diffInMinutes = (new Date() - new Date(invoice.createdAt)) / (1000 * 60);
    const isTimeExpired = diffInMinutes > branch.deletion_window_minutes;
    if (isTimeExpired && branch.is_deletion_allowed === false) {
      return next(new AppError(`انتهت مهلة التعديل (${branch.deletion_window_minutes} دقيقة).`, 403));
    }
  }

  const newTotal = total_amount !== undefined ? Number(total_amount) : invoice.total_amount;
  const newPaid = paid_amount !== undefined ? Number(paid_amount) : invoice.paid_amount;

  if (isNaN(newTotal) || newTotal <= 0 || isNaN(newPaid) || newPaid < 0 || newPaid > newTotal) {
    return next(new AppError('القيم المدخلة غير صحيحة', 400));
  }

  // 🛡️ [القاعدة المحاسبية الذهبية]: الفحص المبكر جداً للوردية المغلقة!
  let oldCashFlow = null;
  if (invoice.paid_amount > 0) {
    oldCashFlow = await CashFlow.findOne({
      vendor_id: invoice.vendor_id._id,
      type: 'VENDOR_PAYMENT',
      branch_id: invoice.branch_id,
      createdAt: { $gte: new Date(invoice.createdAt.getTime() - 60000), $lte: new Date(invoice.createdAt.getTime() + 60000) }
    }).populate('shift_id');

    // إذا كانت الفاتورة مرتبطة بوردية مغلقة، نمنع التعديل نهائياً مهما كان الحقل المعدل!
    if (oldCashFlow && oldCashFlow.shift_id && oldCashFlow.shift_id.status === 'CLOSED') {
      return next(new AppError('❌ لا يمكن التعديل على هذه الفاتورة بأي شكل لأنها مسجلة ضمن وردية تم إغلاقها وتوريدها للرئيسية!', 403));
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (newPaid !== invoice.paid_amount) {
      if (newPaid > 0) {
        if (oldCashFlow) {
          oldCashFlow.amount = newPaid;
          await oldCashFlow.save({ session });
        } else {
          const activeShift = await Shift.findOne({ branch_id: branch._id, status: 'OPEN' }).lean();
          if (!activeShift) throw new Error('NO_OPEN_SHIFT');

          await CashFlow.create([{
            shift_id: activeShift._id, type: 'VENDOR_PAYMENT', amount: newPaid,
            description: `دفعة مستقطعة من فاتورة رقم: ${invoice_number || invoice._id.toString().slice(-4)} (مُعدلة)`,
            vendor_id: invoice.vendor_id._id, branch_id: branch._id, organization_id: branch.organization_id
          }], { session });
        }
      } else if (newPaid === 0 && oldCashFlow) {
        await CashFlow.findByIdAndDelete(oldCashFlow._id, { session });
      }
    }

    invoice.total_amount = newTotal;
    invoice.paid_amount = newPaid;
    invoice.remaining_amount = newTotal - newPaid;
    if (invoice_number !== undefined) invoice.invoice_number = invoice_number.trim();
    if (notes !== undefined) invoice.notes = notes.trim();
    if (image_url) invoice.image_url = image_url;

    await invoice.save({ session });

    await session.commitTransaction();
    session.endSession();
    
    // 🔔 إشعار التعديل (يعمل للجميع الآن)
    try {
      const owner = await User.findOne({ organization_id: branch.organization_id, role: 'OWNER' }).select('notifications').lean();
      if (!owner || owner.notifications?.invoice_deleted !== false) {
        const senderName = req.user.name || 'مستخدم بالنظام';
        const notification = await Notification.create({
          organization_id: branch.organization_id,
          branch_id: branch._id,
          target_role: 'OWNER',
          title: 'تنبيه: تم تعديل فاتورة ✏️',
          message: `قام (${senderName}) بتعديل فاتورة المورد (${invoice.vendor_id?.name}) لتصبح بإجمالي ${newTotal} ج.م في فرع (${branch.name}).`,
          type: 'SYSTEM',
          link: '/owner/shifts'
        });
        socket.getIO().to(branch.organization_id.toString()).emit('new_notification', notification);
      }
    } catch (notifErr) { console.error('Audit Notification Error:', notifErr); }

    res.status(200).json({ message: 'تم تعديل الفاتورة بنجاح', invoice });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    if (error.message === 'NO_OPEN_SHIFT') return next(new AppError('لا توجد وردية مفتوحة لخصم المبلغ الجديد من الدرج', 403));
    return next(new AppError('حدث خطأ أثناء التعديل المحاسبي', 500));
  }
});

// ==========================================
// 📊 4. كشف حساب المورد (Ultra Optimized 🚀)
// ==========================================
const getVendorStatement = asyncHandler(async (req, res, next) => {
  const { vendor_id } = req.query;
  const branchId = req.user.role === 'CASHIER' ? req.user.branch_id : req.query.branch_id;
  const ownerOrgId = req.user.organization_id;

  if (!branchId || !vendor_id) return next(new AppError('يجب تحديد الفرع والمورد', 400));

  const [branch, vendor] = await Promise.all([
    Branch.findOne({ _id: branchId, organization_id: ownerOrgId }).lean(),
    Vendor.findOne({ _id: vendor_id, organization_id: ownerOrgId }).lean()
  ]);

  if (!branch || !vendor) return next(new AppError('بيانات غير صالحة', 403));

  const branchShifts = await Shift.find({ branch_id: branch._id }).select('_id').lean();
  const shiftIds = branchShifts.map(s => s._id);

  const [invoices, payments] = await Promise.all([
    VendorInvoice.find({ branch_id: branch._id, vendor_id: vendor._id, deleted_at: null })
      .select('total_amount paid_amount remaining_amount invoice_number image_url notes createdAt').lean(),
    CashFlow.find({ vendor_id: vendor._id, type: 'VENDOR_PAYMENT', shift_id: { $in: shiftIds }, description: { $not: /^دفعة مستقطعة من فاتورة/ } })
      .select('amount description createdAt').lean()
  ]);

  const transactionHistory = [
    ...invoices.map(inv => ({ id: inv._id, date: inv.createdAt, type: 'INVOICE', amount: inv.total_amount, paid_at_time: inv.paid_amount, remaining: inv.remaining_amount, reference: inv.invoice_number, image: inv.image_url, notes: inv.notes })),
    ...payments.map(pay => ({ id: pay._id, date: pay.createdAt, type: 'PAYMENT', amount: pay.amount, reference: 'سداد نقدي مستقل', image: null, notes: pay.description }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  const totalInvoices = invoices.reduce((sum, inv) => sum + inv.total_amount, 0);
  const totalIndependentPayments = payments.reduce((sum, pay) => sum + pay.amount, 0);
  const totalInvoicePayments = invoices.reduce((sum, inv) => sum + inv.paid_amount, 0);

  res.status(200).json({
    vendor_info: { name: vendor.name, company: vendor.company_name, total_due: totalInvoices - (totalIndependentPayments + totalInvoicePayments) },
    history: transactionHistory
  });
});

module.exports = { addInvoice, getVendorStatement, deleteInvoice, updateInvoice };