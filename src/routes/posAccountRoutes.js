const express = require('express');
const router = express.Router();
const { getPosAccount, upsertPosAccount } = require('../controllers/posAccountController');
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');

router.use(protect);
router.use(authorize('OWNER')); // المالك فقط يتحكم في حسابات الفروع

router.get('/:branchId', getPosAccount);
router.post('/:branchId', upsertPosAccount);

module.exports = router;