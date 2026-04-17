const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: function () {
        return this.role !== 'SUPER_ADMIN';
      },
      index: true,
    },
    branch_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'اسم المستخدم مطلوب'],
      trim: true,
    },
    role: {
      type: String,
      enum: ['SUPER_ADMIN', 'OWNER', 'CASHIER', 'FLOOR_WORKER'],
      required: true,
    },
    employee_title: {
      type: String,
      enum: ['CASHIER', 'FLOOR_WORKER', 'NOT_APPLICABLE'],
      default: 'NOT_APPLICABLE',
    },
    phone: {
      type: String,
      required: [true, 'رقم الهاتف مطلوب'],
      unique: true,
      index: true,
    },
    password_hash: {
      type: String,
      required: function () {
        return this.role !== 'FLOOR_WORKER';
      },
      select: false,
    },
    pin_code: {
      type: String,
      select: false,
    },
    current_session_id: {
      type: String,
      default: null,
    },
    daily_wage: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'SUSPENDED', 'TERMINATED'],
      default: 'ACTIVE',
    },
    hiring_date: {
      type: Date,
      default: Date.now,
    },
    deleted_at: {
      type: Date,
      default: null,
      index: true,
    },
    is_dark_mode: {
      type: Boolean,
      default: false,
    },
    // 🚀 [الجديد] حقول الإشعارات الـ 5 المعتمدة
    notifications: {
      shift_opened: { type: Boolean, default: true },
      shift_closed: { type: Boolean, default: true },
      large_expense: { type: Boolean, default: true },
      vendor_payment: { type: Boolean, default: true },
      new_invoice: { type: Boolean, default: true },
      invoice_deleted: { type: Boolean, default: true }
    },
    current_session_id: {
      type: String,
      default: null,
    },
    // 🚀 [الجديد] حقل حفظ الـ Refresh Token للأمان
    refresh_token: {
      type: String,
      default: null,
      select: false, // مخفي للأمان (لا يرجع في استعلامات البحث العادية)
    },
  },
  {
    timestamps: true,
  }
  ,
);

module.exports = mongoose.model('User', userSchema);