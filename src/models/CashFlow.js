const mongoose = require('mongoose');

const cashFlowSchema = new mongoose.Schema(
  {
    shift_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shift',
      required: [true, 'يجب ربط الحركة بوردية محددة'],
      index: true,
    },
    type: {
      type: String,
      enum: ['INCOME', 'EXPENSE', 'VENDOR_PAYMENT'],
      required: [true, 'نوع الحركة مطلوب'],
    },
    expense_category: {
      type: String,
      enum: ['OPERATION', 'DAMAGE', 'PERSONAL', 'OTHER'],
      default: null,
      validate: {
        validator: function (value) {
          if (this.type === 'EXPENSE' && !value) return false;
          return true;
        },
        message: 'يجب تحديد تصنيف المصروفات إذا كان نوع الحركة صادر (EXPENSE)',
      },
    },
    // 👇 التعديل الجديد: لربط السلفة بعامل محدد لتصفية حسابه آخر الشهر
    employee_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      validate: {
        validator: function (value) {
          if (this.expense_category === 'PERSONAL' && !value) return false;
          return true;
        },
        message: 'يجب تحديد اسم العامل عند تسجيل سلفة (PERSONAL)',
      },
    },
    amount: {
      type: Number,
      required: [true, 'المبلغ مطلوب'],
      min: [0.1, 'يجب إدخال مبلغ صحيح أكبر من الصفر'],
    },
    description: {
      type: String,
      required: [true, 'وصف الحركة مطلوب (مثال: دفع كهرباء، سلفة لمحمود)'],
      trim: true,
    },
    vendor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      default: null,
      validate: {
        validator: function (value) {
          if (this.type === 'VENDOR_PAYMENT' && !value) return false;
          return true;
        },
        message: 'يجب تحديد المورد في حالة الدفع لمندوب (VENDOR_PAYMENT)',
      },
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('CashFlow', cashFlowSchema);
