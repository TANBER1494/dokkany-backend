const express = require('express');
const router = express.Router();
const { 
  addBranch, 
  getBranches, 
  updateBranchSettings, 
  deleteBranch, 
  reactivateBranch, 
  hardDeleteBranch 
} = require('../controllers/branchController');
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');

// ==========================================
// 🛡️ الجدار الناري (للملاك فقط)
// ==========================================
router.use(protect);
router.use(authorize('OWNER')); 

// ==========================================
// 🔗 مسارات الفروع
// ==========================================
router.post('/', addBranch);
router.get('/', getBranches);
router.put('/:id', updateBranchSettings);
router.delete('/:id', deleteBranch);
router.put('/:id/reactivate', reactivateBranch); 
router.delete('/:id/hard-delete', hardDeleteBranch);

module.exports = router;