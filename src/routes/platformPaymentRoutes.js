const express = require('express');
const router = express.Router();

// 1. استدعاء دوال المتحكم المالي
const {
  submitPaymentRequest,
  getOwnerPaymentHistory,
  getPendingPayments,
  reviewPaymentRequest,
  clearBranchHistory
} = require('../controllers/platformPaymentController');

// 2. استدعاء الجدار الناري (Middleware)
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');

// 3. استدعاء محرك رفع الصور (Multer Cloudinary)
// تأكد من أن المسار صحيح حسب مكان ملف fileUpload.js في مشروعك
const upload = require('../utils/fileUpload'); 

// ==========================================
// 🛡️ تفعيل الحماية الأساسية على كل المسارات
// ==========================================
router.use(protect);

// ==========================================
// 💼 مسارات المالك (OWNER)
// ==========================================

/**
 * @route   POST /api/payments/request
 * @desc    رفع طلب تجديد اشتراك (مع إجبارية رفع صورة الإيصال)
 * @access  Private (OWNER Only)
 */
router.post(
  '/request',
  authorize('OWNER'),
  upload.single('receipt_image'), // 🚀 استقبال الصورة بحقل receipt_image
  submitPaymentRequest
);

/**
 * @route   GET /api/payments/history
 * @desc    جلب سجل طلبات الدفع الخاصة بالمالك لمتابعة حالتها
 * @access  Private (OWNER Only)
 */
router.get(
  '/history',
  authorize('OWNER'),
  getOwnerPaymentHistory
);

// ==========================================
// 👑 مسارات الإدارة العليا (SUPER_ADMIN)
// ==========================================

/**
 * @route   GET /api/payments/pending
 * @desc    جلب جميع الطلبات المعلقة التي تحتاج لمراجعة الإدارة
 * @access  Private (SUPER_ADMIN Only)
 */
router.get(
  '/pending',
  authorize('SUPER_ADMIN'),
  getPendingPayments
);

/**
 * @route   PUT /api/payments/:id/review
 * @desc    مراجعة الطلب (APPROVE / REJECT) والتمديد التلقائي للفرع
 * @access  Private (SUPER_ADMIN Only)
 */
router.put(
  '/:id/review',
  authorize('SUPER_ADMIN'),
  reviewPaymentRequest
);

/**
 * @route   DELETE /api/payments/branches/:branchId
 * @desc    حذف تاريخ الفرع (حذف ناعم)
 * @access  Private (OWNER Only)
 */
router.delete(
  '/branches/:branchId',
  authorize('OWNER'),
  clearBranchHistory
);

module.exports = router;