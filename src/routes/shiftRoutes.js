const express = require('express');
const router = express.Router();

const {
  openShift,
  getActiveShift,
  closeShift,
  getShiftsHistory,
  getLastClosedShift,
  getShiftTimeline,
  acknowledgeShift, // 👈 تم الدمج هنا (Clean Code)
} = require('../controllers/shiftController');

const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const { checkSubscription } = require('../middlewares/subscriptionMiddleware');
const rateLimit = require('express-rate-limit');

// ==========================================
// 🛡️ الجدار الناري العام
// ==========================================
router.use(protect);

// ==========================================
// 🔗 مسارات الورديات (Static Routes First 🚀)
// ==========================================

// 1. المسارات العامة للورديات
router.post('/', authorize('OWNER', 'CASHIER'), checkSubscription, openShift);
router.get('/', authorize('OWNER', 'CASHIER'), getShiftsHistory);

// ==========================================
// 2. مسارات الحالة الثابتة (Active & Last-Closed)
// ==========================================

// 🛡️ SECURITY FIX: حماية مسار الـ PIN من التخمين العشوائي (Brute Force)
const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 5, // 5 محاولات فقط!
  message: 'محاولات إدخال PIN كثيرة جداً، يرجى المحاولة لاحقاً.'
});

router.get('/active', authorize('OWNER', 'CASHIER'), getActiveShift);

// 🛡️ تم حقن pinLimiter هنا لحماية هذا المسار تحديداً
router.put(
  '/active/acknowledge',
  authorize('OWNER', 'CASHIER'),
  checkSubscription,
  pinLimiter, // 👈 نقطة الحماية (Checkpoint)
  acknowledgeShift
);

router.get('/last-closed', authorize('OWNER', 'CASHIER'), getLastClosedShift);

// ==========================================
// 🔗 مسارات الورديات (Dynamic Routes Last 🚀)
// ==========================================
// 3. المسارات التي تتطلب ID (يجب أن تكون في النهاية دائماً)
router.get('/:id/timeline', authorize('OWNER', 'CASHIER'), getShiftTimeline);
router.put(
  '/:id/close',
  authorize('OWNER', 'CASHIER'),
  checkSubscription,
  closeShift
);

module.exports = router;