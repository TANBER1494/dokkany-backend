const express = require('express');
const router = express.Router();
const { 
  adminResetUserPassword, 
  getAllOwners, 
  getAllBranches, 
  adminUpdatePassword 
} = require('../controllers/adminController');
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');

// Security Middleware: SUPER_ADMIN Only
router.use(protect);
router.use(authorize('SUPER_ADMIN'));

// Owners & Branches Management
router.get('/owners', getAllOwners);
router.get('/branches', getAllBranches);

// Password Management
router.put('/reset-user-password', adminResetUserPassword);
router.put('/password', adminUpdatePassword);

module.exports = router;