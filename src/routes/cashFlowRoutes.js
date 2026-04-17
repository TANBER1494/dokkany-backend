const express = require('express');
const router = express.Router();

const {
  addCashFlow,
  getShiftCashFlows,
  deleteCashFlow
} = require('../controllers/cashFlowController');

const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const { checkSubscription } = require('../middlewares/subscriptionMiddleware');

// ==========================================
// 🛡️ الجدار الناري العام 
// ==========================================
router.use(protect);
router.use(authorize('OWNER', 'CASHIER'));

// ==========================================
// 🔗 مسارات حركات الخزينة
// ==========================================
// 1. تسجيل حركة جديدة (يتطلب اشتراك فعال)
router.post('/', checkSubscription, addCashFlow);

// 2. جلب الحركات لوردية محددة (قراءة فقط)
router.get('/shift/:shift_id', getShiftCashFlows);

// 3. حذف أو تراجع عن حركة (يتطلب اشتراك فعال)
// 💡 تلميح: عند الحذف من قبل المالك، يجب على الفرونت إند إرسال ?branch_id=xxx في الرابط ليمر من الـ Middleware
router.delete('/:id', checkSubscription, deleteCashFlow);

module.exports = router;