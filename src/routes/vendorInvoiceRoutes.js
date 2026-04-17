const express = require('express');
const router = express.Router();
const upload = require('../utils/fileUpload');

// 1. استدعاء دوال المتحكم
const {
  addInvoice,
  getVendorStatement,
  deleteInvoice,
  updateInvoice

} = require('../controllers/vendorInvoiceController');

// 2. استدعاء الجدار الناري
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const { checkSubscription } = require('../middlewares/subscriptionMiddleware');

// ==========================================
// 🛡️ الجدار الناري العام
// ==========================================
router.use(protect);

// ==========================================
// 🔗 مسارات فواتير الموردين (Vendor Invoices Endpoints)
// ==========================================

/**
 * @route   POST /api/vendor-invoices
 * @desc    تسجيل فاتورة جديدة (بضاعة نزلت الفرع + صورة الفاتورة)
 */
router.post(
  '/', 
  authorize('CASHIER', 'OWNER'), 
  upload.single('invoice_image'), 
  checkSubscription,              
  addInvoice                     
);

/**
 * @route   GET /api/vendor-invoices/statement
 * @desc    عرض كشف الحساب والمديونية الصافية لمورد في فرع معين
 * @access  Private (CASHIER, OWNER) - الكاشير يحتاج رؤية الدين قبل الدفع للمندوب
 */
router.get('/statement', authorize('CASHIER', 'OWNER'), getVendorStatement);

/**
 * @route   DELETE /api/vendor-invoices/:id
 * @desc    التراجع عن فاتورة بالخطأ
 * @access  Private (CASHIER, OWNER) - الكاشير يحتاج رؤية الدين قبل الدفع للمندوب
 */
router.delete('/:id', authorize('CASHIER', 'OWNER'), checkSubscription, deleteInvoice);


/**
 * @route   PUT /api/vendor-invoices/:id
 * @desc    تعديل فاتورة مسجلة
 */
router.put(
  '/:id', 
  authorize('CASHIER', 'OWNER'), 
  upload.single('invoice_image'), 
  checkSubscription, 
  updateInvoice // الدالة الجديدة التي أضفناها للتو
);


module.exports = router;