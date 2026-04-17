const mongoose = require('mongoose');

const customerDebtSchema = new mongoose.Schema(
  {
    branch_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      index: true,
    },
    customer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'يجب تحديد اسم الزبون'],
      index: true,
    },
    shift_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shift',
      required: [true, 'يجب ربط الحركة بالوردية الحالية'],
    },
    type: {
      type: String,
      enum: ['CREDIT', 'PAYMENT'], // CREDIT = أخذ بضاعة شكك (عليه)، PAYMENT = سدد فلوس (دفع)
      required: true,
    },
    amount: {
      type: Number,
      required: [true, 'يجب إدخال المبلغ'],
      min: [0.1, 'المبلغ يجب أن يكون أكبر من الصفر'],
    },
    notes: {
      type: String,
      required: [true, 'يجب كتابة التفاصيل (مثال: جبنة وعيش، أو سداد جزء من الدين)'],
      trim: true,
    },
    deleted_at: {
      type: Date,
      default: null, // للتراجع في حالة الخطأ
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CustomerDebt', customerDebtSchema);