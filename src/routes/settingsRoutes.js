const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const {
  getSettings,
  updatePhone,
  updatePassword,
  updatePreferences
} = require('../controllers/settingsController');

// جميع مسارات الإعدادات تتطلب تسجيل دخول (protect) وأن يكون المستخدم مالكاً (OWNER)
router.use(protect);
//  التعديل هنا: السماح للسوبر أدمن بدخول مسارات الإعدادات
router.use(authorize('OWNER', 'SUPER_ADMIN'));

router.get('/', getSettings);
router.put('/phone', updatePhone);
router.put('/password', updatePassword);
router.put('/preferences', updatePreferences);

module.exports = router;