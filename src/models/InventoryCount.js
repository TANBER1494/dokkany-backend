const mongoose = require('mongoose');

const inventoryCountSchema = new mongoose.Schema(
  {
    branch_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      index: true,
    },
    performed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // قائمة المنتجات التي تم عدّها فعلياً
    items: [
      {
        product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        product_name: String, // نحفظ الاسم تحسباً لحذفه مستقبلاً
        quantity_found: { type: Number, required: true },
        purchase_price_at_time: { type: Number, required: true },
        selling_price_at_time: { type: Number, required: true },
      }
    ],
    
    // الحسابات المالية الختامية للجرد
    total_stock_purchase_value: { type: Number, default: 0 }, 
    total_stock_selling_value: { type: Number, default: 0 },  
    total_vendor_debts: { type: Number, default: 0 },        
    total_customer_debts: { type: Number, default: 0 },      
    fixed_expenses: { type: Number, default: 0 },            
    
    // 🛡️ التعديل الجراحي: إضافة الحقول التي كانت تسقط أثناء الحفظ
    actual_cash: { type: Number, default: 0 },           // النقدية بالخزينة
    previous_capital: { type: Number, default: 0 },      // رأس المال السابق (الافتتاحي)
    net_profit: { type: Number, default: 0 },            // صافي الربح / الخسارة
    
    // المعادلة الذهبية
    net_store_value: { type: Number, required: true },
    
    notes: { type: String, trim: true },
  },
  {
    timestamps: true, // تاريخ الجرد
  }
);

module.exports = mongoose.model('InventoryCount', inventoryCountSchema);