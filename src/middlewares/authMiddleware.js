const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  // 1. التأكد من وجود التوكن بشكل صارم
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res
      .status(401)
      .json({ message: 'غير مصرح لك بالوصول، بيانات الاعتماد مفقودة.' });
  }

  try {
    // 2. فك التشفير
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 3. جلب المستخدم (نستثني الباسورد لسرعة الأداء وتقليل الحمل على الذاكرة)
    req.user = await User.findById(decoded.id).select('-password_hash');

    if (!req.user || req.user.deleted_at) {
      return res
        .status(401)
        .json({ message: 'إجراء أمني: حساب المستخدم لم يعد موجوداً.' });
    }

    // 4. الجلسة الأحادية
    if (
      req.user.current_session_id &&
      decoded.session_id !== req.user.current_session_id
    ) {
      return res.status(401).json({
        message:
          'تم تسجيل الدخول من جهاز آخر! تم إنهاء جلستك الحالية لحماية النظام.',
      });
    }

    // 5. فحص حالة الحساب
    if (req.user.status !== 'ACTIVE') {
      return res
        .status(403)
        .json({ message: 'هذا الحساب معطل حالياً، راجع الإدارة.' });
    }

    next();
  } catch (error) {
    return res
      .status(401)
      .json({ message: 'انتهت صلاحية الجلسة أو أن التوكن مزيف.' });
  }
};

module.exports = { protect };
