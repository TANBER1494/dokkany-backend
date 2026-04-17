const express = require('express');
const router = express.Router();

// 1. استدعاء دوال المتحكم (Controllers)
const {
  addCategory,
  getCategories,
  updateCategory,
  deleteCategory
} = require('../controllers/categoryController');

// 2. استدعاء الجدار الناري (Middlewares)
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const { checkSubscription } = require('../middlewares/subscriptionMiddleware');

// ==========================================
// 🛡️ الجدار الناري العام للمسار (Global Route Middlewares)
// ==========================================
// أي طلب (Request) يدخل إلى مسار الفئات، يجب أن يمر بهذين الشرطين أولاً:
// 1. يمتلك توكن صالح (مسجل دخول).
// 2. يمتلك صلاحية 'OWNER' (الكاشير وعامل الأرضية لا يديرون الفئات).
router.use(protect);
router.use(authorize('OWNER'));

// ==========================================
// 🔗 مسارات الفئات (Category Endpoints)
// ==========================================

/**
 * @route   POST /api/categories
 * @desc    إضافة فئة جديدة للفرع (مثال: ألبان، معلبات)
 * @access  Private (OWNER) + فحص الاشتراك (يُمنع الإضافة إذا كان الفرع منتهي الاشتراك)
 */
router.post('/', checkSubscription, addCategory);

/**
 * @route   GET /api/categories
 * @desc    جلب جميع الفئات لفرع معين (يجب تمرير ?branch_id=...)
 * @access  Private (OWNER) - (مسموح بالرؤية دائماً Read-Only)
 */
router.get('/', getCategories);

/**
 * @route   PUT /api/categories/:id
 * @desc    تعديل اسم أو وصف الفئة
 * @access  Private (OWNER) + فحص الاشتراك
 */
router.put('/:id', checkSubscription, updateCategory);

/**
 * @route   DELETE /api/categories/:id
 * @desc    حذف فئة (Soft Delete - ممنوع إذا كان بها منتجات)
 * @access  Private (OWNER) + فحص الاشتراك
 */
router.delete('/:id', checkSubscription, deleteCategory);

module.exports = router;