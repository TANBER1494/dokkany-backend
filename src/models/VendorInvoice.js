const mongoose = require('mongoose');

const vendorInvoiceSchema = new mongoose.Schema(
  {
    branch_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: [true, 'يجب تحديد الفرع الذي استلم البضاعة'],
      index: true,
    },
    vendor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: [true, 'يجب تحديد المورد/الشركة'],
      index: true,
    },
    entered_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    invoice_number: {
      type: String,
      trim: true,
      default: null,
    },
    total_amount: {
      type: Number,
      required: [true, 'يجب إدخال إجمالي قيمة الفاتورة'],
      min: [1, 'قيمة الفاتورة يجب أن تكون أكبر من الصفر'],
    },
    paid_amount: {
      type: Number,
      default: 0,
      min: [0, 'المبلغ المدفوع لا يمكن أن يكون سالباً'],
    },
    remaining_amount: {
      type: Number,
      default: function() {
        return this.total_amount - this.paid_amount;
      }
    },
    image_url: {
      type: String,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: null,
    },
    deleted_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true, 
  }
);

module.exports = mongoose.model('VendorInvoice', vendorInvoiceSchema);