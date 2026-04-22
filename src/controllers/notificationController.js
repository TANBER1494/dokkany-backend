const Notification = require('../models/Notification');
const User = require('../models/User'); // 👈 لجلب التوكنات
const admin = require('firebase-admin');
const socket = require('../models/socket'); // 👈 للاتصال اللحظي
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// 🚀 1. تهيئة الفايربيز (Firebase Admin Initialization)
// ==========================================
try {
  // نقوم باستدعاء المفتاح السري الذي حملته
  const serviceAccount = require('../config/firebase-key.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('🔥 Firebase Admin Initialized Successfully');
} catch (error) {
  console.error('❌ فشل تهيئة Firebase Admin (تأكد من وجود ملف firebase-key.json في مجلد config):', error.message);
}

// ==========================================
// 🎯 2. دالة السينيورز: المدفع الذكي (قاعدة بيانات + Socket + FCM)
// هذه الدالة سيتم تصديرها لاستخدامها في أي Controller آخر
// ==========================================
const sendAppNotification = async ({ title, message, type, target_role, target_user_id, organization_id, link }) => {
  try {
    // 1. حفظ الإشعار في قاعدة البيانات كمرجع تاريخي
    const newNotification = await Notification.create({
      title, message, type, target_role, target_user_id, organization_id, link
    });

    // 2. تحديد الغرفة للـ Socket.io (للشاشات المفتوحة)
    let room;
    if (target_role === 'SUPER_ADMIN') room = 'SUPER_ADMIN_ROOM';
    else if (target_role === 'OWNER') room = organization_id.toString();
    else if (target_user_id) room = target_user_id.toString();

    if (room && socket.getIO()) {
      socket.getIO().to(room).emit('receiveNotification', newNotification);
    }

    // 3. 🚀 إرسال الـ Push Notification للموبايلات المغلقة (FCM)
    let query = { status: 'ACTIVE', fcm_token: { $ne: null } };
    
    // فلترة المستهدفين
    if (target_role === 'SUPER_ADMIN') query.role = 'SUPER_ADMIN';
    else if (target_role === 'OWNER') { query.role = 'OWNER'; query.organization_id = organization_id; }
    else if (target_user_id) query._id = target_user_id;

    // جلب التوكنات للمستهدفين
    const targetUsers = await User.find(query).select('fcm_token').lean();
    const tokens = targetUsers.map(user => user.fcm_token).filter(Boolean);

    // إذا وجدنا توكنات، نطلق الإشعار!
    if (tokens.length > 0) {
      const payload = {
        notification: {
          title: title,
          body: message,
          // icon: 'https://your-domain.com/logo.png' // يمكن إضافة رابط لوجو النظام هنا لاحقاً
        },
        tokens: tokens, // إرسال لمجموعة توكنز دفعة واحدة بأداء عالي
      };

      const response = await admin.messaging().sendEachForMulticast(payload);
      console.log(`🚀 FCM Sent: ${response.successCount} Success, ${response.failureCount} Failed`);
    }

    return newNotification;
  } catch (error) {
    console.error('❌ خطأ في نظام الإرسال المزدوج للإشعارات:', error);
  }
};


// ==========================================
// 🛠️ دوال جلب وإدارة الإشعارات (كما هي)
// ==========================================

const getNotifications = asyncHandler(async (req, res, next) => {
  const { role, _id, organization_id } = req.user;
  let query = {};

  if (role === 'SUPER_ADMIN') query.target_role = 'SUPER_ADMIN';
  else if (role === 'OWNER') { query.organization_id = organization_id; query.target_role = 'OWNER'; }
  else if (role === 'CASHIER') { query.organization_id = organization_id; query.target_role = 'CASHIER'; query.target_user_id = _id; }
  else return res.status(200).json([]);

  const notifications = await Notification.find(query).sort({ createdAt: -1 }).limit(50).lean();
  res.status(200).json(notifications);
});

const markAsRead = asyncHandler(async (req, res, next) => {
  const { role, _id, organization_id } = req.user;
  let query = { _id: req.params.id };

  if (role === 'SUPER_ADMIN') query.target_role = 'SUPER_ADMIN';
  else { query.organization_id = organization_id; if (role === 'CASHIER') query.target_user_id = _id; }

  const notification = await Notification.findOneAndUpdate(query, { is_read: true });
  if (!notification) return next(new AppError('الإشعار غير موجود', 404));
  res.status(200).json({ message: 'تم التحديد كمقروء' });
});

const markAllAsRead = asyncHandler(async (req, res, next) => {
  const { role, _id, organization_id } = req.user;
  let query = { is_read: false };

  if (role === 'SUPER_ADMIN') query.target_role = 'SUPER_ADMIN';
  else { query.organization_id = organization_id; query.target_role = role; if (role === 'CASHIER') query.target_user_id = _id; }

  await Notification.updateMany(query, { is_read: true });
  res.status(200).json({ message: 'تم تحديد الكل كمقروء' });
});

const deleteAllReadNotifications = asyncHandler(async (req, res, next) => {
  const { role, _id, organization_id } = req.user;
  let query = { is_read: true };

  if (role === 'SUPER_ADMIN') query.target_role = 'SUPER_ADMIN';
  else { query.organization_id = organization_id; query.target_role = role; if (role === 'CASHIER') query.target_user_id = _id; }

  await Notification.deleteMany(query);
  res.status(200).json({ message: 'تم تنظيف الإشعارات المقروءة' });
});

const deleteNotification = asyncHandler(async (req, res, next) => {
  const { role, _id, organization_id } = req.user;
  let query = { _id: req.params.id };

  if (role === 'SUPER_ADMIN') query.target_role = 'SUPER_ADMIN';
  else { query.organization_id = organization_id; if (role === 'CASHIER') query.target_user_id = _id; }

  const deleted = await Notification.findOneAndDelete(query);
  if (!deleted) return next(new AppError('الإشعار غير موجود', 404));
  res.status(200).json({ message: 'تم حذف الإشعار' });
});

module.exports = { 
  sendAppNotification,
  getNotifications, 
  markAsRead, 
  markAllAsRead, 
  deleteNotification, 
  deleteAllReadNotifications 
};