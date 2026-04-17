const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');

const { 
  getNotifications, 
  markAsRead, 
  markAllAsRead, 
  deleteNotification, 
  deleteAllReadNotifications 
} = require('../controllers/notificationController');

// ==========================================
// 🛡️ حماية جميع مسارات الإشعارات
// ==========================================
router.use(protect);

// ==========================================
// 🔗 مسارات الإشعارات (الثابت قبل المتغير)
// ==========================================

router.get('/', getNotifications);

// 🚀 المسارات الثابتة (Static)
router.put('/read-all', markAllAsRead);
router.delete('/read', deleteAllReadNotifications);

// 🚀 المسارات المتغيرة (Dynamic)
router.put('/:id/read', markAsRead);
router.delete('/:id', deleteNotification);

module.exports = router;