const express = require('express');
const router = express.Router();
const { registerOwner, login, refreshToken } = require('../controllers/authController');

// ==========================================
// 🔐 مسارات المصادقة وتأسيس النظام (Public Routes)
// ==========================================

router.post('/register-owner', registerOwner);
router.post('/login', login);
router.post('/refresh', refreshToken);

module.exports = router;