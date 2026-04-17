const express = require('express');
const router = express.Router();

const {
  getCustomersList,
  addCustomerWithInitialDebt,
  recordTransaction,
  getCustomerStatement,
  updateCustomer,
  deleteCustomer

} = require('../controllers/customerDebtController');

const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const { checkSubscription } = require('../middlewares/subscriptionMiddleware');

// ==========================================
// 🛡️ الجدار الناري العام
// ==========================================
router.use(protect);
router.use(authorize('CASHIER', 'OWNER'));

// ==========================================
// 🔗 مسارات ديون الزبائن
// ==========================================

router.get('/customers', getCustomersList);
router.post('/customers', checkSubscription, addCustomerWithInitialDebt);
router.post('/transactions', checkSubscription, recordTransaction);
router.get('/customers/:customer_id/statement', getCustomerStatement);
router.put('/customers/:customer_id', checkSubscription, updateCustomer); 
router.delete('/customers/:customer_id', checkSubscription, deleteCustomer);

module.exports = router;