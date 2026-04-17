const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    branch_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: [true, 'يجب تحديد الفرع (كل فرع له تصنيفاته)'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'اسم الفئة مطلوب (مثال: ألبان)'],
      trim: true,
    },
    description: {
      type: String,
      default: null,
      trim: true,
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

module.exports = mongoose.model('Category', categorySchema);