const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    branch_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: [true, 'المنتج يجب أن يتبع لفرع معين'],
      index: true,
    },
    category_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'الفئة مطلوبة لتسهيل الجرد'],
    },
    unit_type: { type: String, default: 'قطعة' },
    barcode: {
      type: String,
      required: [true, 'الباركود مطلوب'],
      trim: true,
      index: true, // لتسريع عملية البحث إذا استخدمنا قارئ الباركود لاحقاً
    },
    name: {
      type: String,
      required: [true, 'اسم المنتج مطلوب'],
      trim: true,
    },
    purchase_price: {
      type: Number,
      required: [true, 'سعر الشراء (التكلفة) مطلوب'],
      min: [0, 'لا يمكن أن يكون سعر الشراء سالباً'],
    },
    selling_price: {
      type: Number,
      required: [true, 'سعر البيع للجمهور مطلوب'],
      min: [0, 'لا يمكن أن يكون سعر البيع سالباً'],
      validate: {
        validator: function (value) {
          // في حال كان المنتج يُباع بخسارة، سنسمح بذلك لمرونة العروض، لكن نُفضل التنبيه إن أمكن
          return true;
        },
      },
    },
    stock_quantity: {
      type: Number,
      required: [true, 'الكمية الحالية في المخزن مطلوبة'],
      min: [0, 'الكمية لا يمكن أن تكون سالبة'],
    },
    image_url: {
      type: String,
      default: null, // صورة المنتج اختيارية
    },
    deleted_at: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true, // سيوفر updated_at لمعرفة آخر تعديل للسعر
  }
);

// منع تكرار الباركود لنفس المنتج داخل نفس الفرع (لكن يمكن أن يتكرر في فروع أخرى)
productSchema.index({ branch_id: 1, barcode: 1 }, { unique: true });

module.exports = mongoose.model('Product', productSchema);
