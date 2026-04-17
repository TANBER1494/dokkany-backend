const express = require('express');
const router = express.Router();
const { getEmployeeSettlement, payEmployeeSettlement } = require('../controllers/payrollController');
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const { checkSubscription } = require('../middlewares/subscriptionMiddleware');

// تفعيل الحماية
router.use(protect);

// السماح للمالك والكاشير (لأن الكاشير هو من يصرف الراتب من درجه الفعلي)
router.use(authorize('OWNER', 'CASHIER'));

// 1. جلب التصفية
router.get('/settlement', getEmployeeSettlement);

// 2. 🚀 المسار الذي كان مفقوداً: صرف الراتب وخصمه من الخزينة
router.post('/settlement', checkSubscription, payEmployeeSettlement);

module.exports = router;