const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'اسم المؤسسة / الماركت مطلوب'],
      trim: true,
    },
    owner_name: {
      type: String,
      required: [true, 'اسم المالك مطلوب'],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'رقم هاتف المالك مطلوب'],
      unique: true, // يمنع تسجيل نفس المؤسسة بنفس الرقم
      index: true,
    },
    max_allowed_branches: {
      type: Number,
      default: 1,
      min: [1, 'يجب أن يكون الحد الأدنى للفروع 1'],
    },
  },
  {
    timestamps: true, // سينشئ تلقائياً created_at و updated_at
  }
);

module.exports = mongoose.model('Organization', organizationSchema);