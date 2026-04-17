const mongoose = require('mongoose');

const shiftSchema = new mongoose.Schema(
  {
    branch_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: [true, 'يجب تحديد الفرع التابع لهذه الوردية'],
      index: true,
    },
    cashier_id: {
      // 👈 هذا أصبح يمثل "حساب جهاز الكاشير / الفرع"
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'يجب تحديد حساب الكاشير المسؤول عن الوردية'],
      index: true,
    },
    shift_type: {
      type: String,
      enum: ['STANDARD', 'DELAY'],
      default: 'STANDARD',
    },
    shift_sequence: {
      type: Number,
      required: [true, 'الرقم التسلسلي للوردية مطلوب'],
    },
    start_time: {
      type: Date,
      default: Date.now,
      required: true,
    },
    end_time: {
      type: Date,
      default: null,
    },
    starting_cash: {
      type: Number,
      required: [true, 'يجب إدخال عهدة استلام الوردية'],
      min: [0, 'لا يمكن أن تكون العهدة بالسالب'],
    },
    total_expenses: {
      type: Number,
      default: 0,
      min: 0,
    },
    ending_cash_actual: {
      type: Number,
      default: null,
    },
    net_shift_profit: {
      type: Number,
      default: null,
    },
    status: {
      type: String,
      enum: ['OPEN', 'CLOSED'],
      default: 'OPEN',
      required: true,
    },
    machines_balances: [
      {
        machine_name: { type: String, required: true },
        balance: { type: Number, required: true, min: 0 },
      },
    ],
    // ==========================================
    // 🚀 [جديد] حقول نظام (الوردية الشبحية وفصل الاستلام)
    // ==========================================
    is_acknowledged: {
      type: Boolean,
      default: false, // 👈 تبدأ كوردية شبحية تعمل بلا مستلم فعلي
    },
    acknowledged_at: {
      type: Date,
      default: null, // 👈 وقت ضغط العامل على زر الاستلام
    },
    acknowledged_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User', // 👈 العامل الفعلي (إبراهيم أو حمادة)
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

shiftSchema.index(
  { branch_id: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'OPEN' } }
);

module.exports = mongoose.model('Shift', shiftSchema);
