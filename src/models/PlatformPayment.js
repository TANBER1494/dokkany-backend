const mongoose = require('mongoose');

const platformPaymentSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'يجب تحديد المؤسسة الدافعة'],
      index: true,
    },
    branch_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: [true, 'يجب تحديد الفرع المرتبط بالدفع'],
    },
    amount_paid: {
      type: Number,
      required: [true, 'يجب تحديد المبلغ المدفوع'],
      min: [1, 'المبلغ يجب أن يكون أكبر من صفر'],
    },
    // 🚀 [جديد] رقم الهاتف المحول منه الكاش
    transfer_number: {
      type: String,
      required: [true, 'يجب إدخال رقم الهاتف الذي تم التحويل منه'],
    },
    // 🚀 [جديد] الباقات المتاحة
    requested_months: {
      type: Number,
      enum: [1, 3, 9],
      required: [true, 'يجب تحديد مدة الاشتراك المطلوبة'],
    },
    payment_method: {
      type: String,
      enum: ['VODAFONE_CASH', 'BANK_TRANSFER'],
      default: 'VODAFONE_CASH',
    },
    // 🚀 [تعديل] أصبحت إجبارية لضمان وجود دليل
    receipt_image_url: {
      type: String,
      required: [true, 'صورة إيصال التحويل مطلوبة لتاكيد الدفع'], 
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING', 
    },
    payment_date: {
      type: Date,
      default: Date.now,
    },
    admin_notes: {
      type: String,
      default: null,
    },
    is_deleted_by_owner: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('PlatformPayment', platformPaymentSchema);