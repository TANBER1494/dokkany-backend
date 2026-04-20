const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
// 1. استدعاء دوال المتحكم (Controllers)
const {
  addProduct,
  getProducts,
  updateProduct,
  deleteProduct,
  exportExcelTemplate,
  importProductsFromExcel
} = require('../controllers/productController');

// 2. استدعاء الجدار الناري (Middlewares)
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const { checkSubscription } = require('../middlewares/subscriptionMiddleware');

// ==========================================
// 🛡️ الجدار الناري العام للمسار (Global Route Middlewares)
// ==========================================
// أي طلب يدخل إلى مسار المنتجات يجب أن يكون من "مالك" مسجل الدخول
router.use(protect);
router.use(authorize('OWNER'));

// ==========================================
// 🔗 مسارات المنتجات (Product Endpoints)
// ==========================================



/**
 * @route   POST /api/products
 * @desc    إضافة منتج جديد للمخزن (باركود، أسعار، كمية)
 * @access  Private (OWNER) + فحص الاشتراك (ممنوع الإضافة لو الاشتراك منتهي)
 */
router.post('/', checkSubscription, addProduct);

/**
 * @route   GET /api/products
 * @desc    جلب المنتجات مع محرك بحث (دعم البحث بالاسم، الباركود، والفئة)
 * @access  Private (OWNER) - (مسموح دائماً رؤية البضاعة Read-Only)
 */
router.get('/', getProducts);

/**
 * @route   PUT /api/products/:id
 * @desc    تعديل بيانات منتج (مثل تحديث سعر البيع أو الكمية)
 * @access  Private (OWNER) + فحص الاشتراك
 */
router.put('/:id', checkSubscription, updateProduct);

/**
 * @route   DELETE /api/products/:id
 * @desc    حذف منتج (Soft Delete) مع تحرير الباركود
 * @access  Private (OWNER) + فحص الاشتراك
 */
router.delete('/:id', checkSubscription, deleteProduct);

/**
 * @route   GET /api/products/export-template
 * @desc    تصدير قالب إكسيل ذكي (مع قوائم منسدلة للأقسام)
 * @access  Private (OWNER) + فحص الاشتراك
 */
router.get('/export-template', checkSubscription, exportExcelTemplate);

/**
 * @route   POST /api/products/import
 * @desc    رفع ملف إكسيل وإدخال المنتجات بالجملة
 * @access  Private (OWNER) + فحص الاشتراك
 */
// ✅ الحل: وضع 'upload.single' قبل 'checkSubscription' لكي يتم قراءة req.body بنجاح
router.post(
  '/import', 
  upload.single('excel_file'), // 1. فك تشفير الملف والبيانات (Multipart Parser)
  checkSubscription,           // 2. الآن أصبح req.body.branch_id متاحاً للفحص 🚀
  importProductsFromExcel      // 3. تنفيذ دالة الاستيراد
);

module.exports = router;
