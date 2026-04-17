const express = require('express');
const router = express.Router();
const { getOwnerMasterDashboard } = require('../controllers/dashboardController');
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');

router.use(protect);
router.use(authorize('OWNER')); // الداشبورد المالي حكر على المالك

router.get('/master', getOwnerMasterDashboard);

module.exports = router;