require('dotenv').config(); // استدعاء متغيرات البيئة
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ==========================================
// 📦 استدعاء جميع الموديلز (13 موديل من هيكل النظام)
// ==========================================
const Branch = require('./src/models/Branch');
const CashFlow = require('./src/models/CashFlow');
const Category = require('./src/models/Category');
const Customer = require('./src/models/Customer');
const CustomerDebt = require('./src/models/CustomerDebt');
const InventoryCount = require('./src/models/InventoryCount');
const Organization = require('./src/models/Organization');
const PlatformPayment = require('./src/models/PlatformPayment');
const Product = require('./src/models/Product');
const Shift = require('./src/models/Shift');
const User = require('./src/models/User');
const Vendor = require('./src/models/Vendor');
const VendorInvoice = require('./src/models/VendorInvoice');

const resetDatabase = async () => {
  try {
    // 1. الاتصال بقاعدة البيانات
    console.log('⏳ جاري الاتصال بقاعدة البيانات...');
    // تأكد من أن مسار الاتصال يطابق الموجود في ملف env الخاص بك
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ تم الاتصال بنجاح!');

    // 2. تدمير جميع البيانات في الـ 13 جدول (الضربة النووية الشاملة)
    console.log('🗑️ جاري مسح جميع الجداول بلا استثناء...');
    
    await Branch.deleteMany({});
    await CashFlow.deleteMany({});
    await Category.deleteMany({});
    await Customer.deleteMany({});
    await CustomerDebt.deleteMany({});
    await InventoryCount.deleteMany({});
    await Organization.deleteMany({});
    await PlatformPayment.deleteMany({});
    await Product.deleteMany({});
    await Shift.deleteMany({});
    await User.deleteMany({});
    await Vendor.deleteMany({});
    await VendorInvoice.deleteMany({});
    
    console.log('✅ تم تنظيف جميع الـ 13 جدول بالكامل!');

    // 3. إعادة إحياء الإدارة العليا (SUPER_ADMIN) حتى لا تُغلق الأبواب
    console.log('👑 جاري إنشاء حساب الإدارة العليا...');
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash('123456', salt); // الباسورد الافتراضي: 123456

    await User.create({
      name: 'TANBER(Super Admin)',
      phone: '01000000000',
      role: 'SUPER_ADMIN',
      employee_title: 'NOT_APPLICABLE',
      password_hash,
      status: 'ACTIVE'
    });

    console.log('✅ تم إنشاء حساب الأدمن بنجاح!');
    console.log('📱 رقم الدخول: 01000000000');
    console.log('🔑 كلمة المرور: 123456');

    console.log('🎉 تمت عملية إعادة ضبط المصنع بنجاح. بيئة العمل الآن نظيفة 100%.');
    process.exit(); // إنهاء السكربت بنجاح

  } catch (error) {
    console.error('❌ حدث خطأ كارثي أثناء المسح:', error);
    process.exit(1);
  }
};

resetDatabase();