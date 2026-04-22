const express = require('express');
const router = express.Router();
const { registerOwner, login, refreshToken,updateFcmToken } = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');

// ==========================================
// 🔐 مسارات المصادقة وتأسيس النظام (Public Routes)
// ==========================================

router.post('/register-owner', registerOwner);
router.post('/login', login);
router.post('/refresh', refreshToken);
router.put('/fcm-token', protect, updateFcmToken);
module.exports = router;