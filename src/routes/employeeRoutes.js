const express = require('express');
const router = express.Router();
const { 
  addEmployee, 
  getEmployees, 
  updateEmployee, 
  deleteEmployee 
} = require('../controllers/employeeController');
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const { checkSubscription } = require('../middlewares/subscriptionMiddleware');

// ==========================================
// 🛡️ الجدار الناري الأساسي
// ==========================================
router.use(protect); 

// ==========================================
// 🔗 مسارات العمال
// ==========================================
// 1. جلب العمال (مسموح للمالك والكاشير)
router.get('/', authorize('OWNER', 'CASHIER'), getEmployees);

// 2. إدارة العمال (مسموح للمالك فقط + يتطلب اشتراك فعال)
router.post('/', authorize('OWNER'), checkSubscription, addEmployee);
router.put('/:id', authorize('OWNER'), checkSubscription, updateEmployee);
router.delete('/:id', authorize('OWNER'), checkSubscription, deleteEmployee);

module.exports = router;