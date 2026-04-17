const express = require('express');
const router = express.Router();
const {
  addVendor,
  getVendors,
  updateVendor,
  deleteVendor,
} = require('../controllers/vendorController');
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');

router.use(protect);

/**
 * 🔗 مسارات الموردين المعدلة
 */

// 1. العرض والإضافة متاح للكاشير والمالك
router.get('/', authorize('OWNER', 'CASHIER'), getVendors);
router.post('/', authorize('OWNER', 'CASHIER'), addVendor); // 👈 تم السماح للكاشير

// 2. التعديل متاح للاثنين (لتصحيح أخطاء الإدخال الفورية)
router.put('/:id', authorize('OWNER', 'CASHIER'), updateVendor); // 👈 تم السماح للكاشير

// 3. الحذف "المالك فقط" (لقفل السجلات المالية ومنع التلاعب بالمديونيات)
router.delete('/:id', authorize('OWNER'), deleteVendor);

module.exports = router;
