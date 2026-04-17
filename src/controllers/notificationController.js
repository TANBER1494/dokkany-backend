const Notification = require('../models/Notification');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// Get notifications based on role isolation
const getNotifications = asyncHandler(async (req, res, next) => {
  const { role, _id, organization_id } = req.user;
  let query = {};

  if (role === 'SUPER_ADMIN') {
    query.target_role = 'SUPER_ADMIN';
  } else if (role === 'OWNER') {
    query.organization_id = organization_id;
    query.target_role = 'OWNER';
  } else if (role === 'CASHIER') {
    query.organization_id = organization_id;
    query.target_role = 'CASHIER';
    query.target_user_id = _id;
  } else {
    return res.status(200).json([]);
  }

  const notifications = await Notification.find(query)
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  res.status(200).json(notifications);
});

// Mark one notification as read
const markAsRead = asyncHandler(async (req, res, next) => {
  const { role, _id, organization_id } = req.user;
  let query = { _id: req.params.id };

  if (role === 'SUPER_ADMIN') {
    query.target_role = 'SUPER_ADMIN';
  } else {
    query.organization_id = organization_id;
    if (role === 'CASHIER') query.target_user_id = _id;
  }

  const notification = await Notification.findOneAndUpdate(query, { is_read: true });
  if (!notification) return next(new AppError('الإشعار غير موجود', 404));

  res.status(200).json({ message: 'تم التحديد كمقروء' });
});

// Mark all notifications as read
const markAllAsRead = asyncHandler(async (req, res, next) => {
  const { role, _id, organization_id } = req.user;
  let query = { is_read: false };

  if (role === 'SUPER_ADMIN') {
    query.target_role = 'SUPER_ADMIN';
  } else {
    query.organization_id = organization_id;
    query.target_role = role;
    if (role === 'CASHIER') query.target_user_id = _id;
  }

  await Notification.updateMany(query, { is_read: true });
  res.status(200).json({ message: 'تم تحديد الكل كمقروء' });
});

// Delete read notifications
const deleteAllReadNotifications = asyncHandler(async (req, res, next) => {
  const { role, _id, organization_id } = req.user;
  let query = { is_read: true };

  if (role === 'SUPER_ADMIN') {
    query.target_role = 'SUPER_ADMIN';
  } else {
    query.organization_id = organization_id;
    query.target_role = role;
    if (role === 'CASHIER') query.target_user_id = _id;
  }

  await Notification.deleteMany(query);
  res.status(200).json({ message: 'تم تنظيف الإشعارات المقروءة' });
});

// Delete specific notification
const deleteNotification = asyncHandler(async (req, res, next) => {
  const { role, _id, organization_id } = req.user;
  let query = { _id: req.params.id };

  if (role === 'SUPER_ADMIN') {
    query.target_role = 'SUPER_ADMIN';
  } else {
    query.organization_id = organization_id;
    if (role === 'CASHIER') query.target_user_id = _id;
  }

  const deleted = await Notification.findOneAndDelete(query);
  if (!deleted) return next(new AppError('الإشعار غير موجود', 404));

  res.status(200).json({ message: 'تم حذف الإشعار' });
});

module.exports = { 
  getNotifications, 
  markAsRead, 
  markAllAsRead, 
  deleteNotification, 
  deleteAllReadNotifications 
};