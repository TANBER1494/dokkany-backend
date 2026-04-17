const express = require('express');
const router = express.Router();

const {
  performInventory,
  getInventoryHistory
} = require('../controllers/inventoryController');

const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const { checkSubscription } = require('../middlewares/subscriptionMiddleware');

router.use(protect);
router.use(authorize('OWNER')); // الجرد من صلاحيات المالك فقط

router.post('/', checkSubscription, performInventory);
router.get('/', getInventoryHistory);

module.exports = router;