const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema(
  {
    // 🚀 الحقل المفقود الضروري جداً للأمان وعزل البيانات
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'يجب ربط المورد بالمؤسسة التابع لها'],
      index: true,
    },
    branch_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: [true, 'يجب تحديد الفرع الذي استلم البضاعة'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'اسم المندوب أو المورد مطلوب'],
      trim: true,
    },
    company_name: {
      type: String,
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'رقم هاتف المندوب مطلوب'],
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    total_due: {
      type: Number,
      default: 0,
      min: [0, 'الرصيد المستحق لا يمكن أن يكون سالباً'],
    },
    deleted_at: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Vendor', vendorSchema);
