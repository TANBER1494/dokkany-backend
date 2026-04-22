const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const Organization = require('../models/Organization');
const Branch = require('../models/Branch');

// أدوات السينيورز 🚀
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// 🛠️ دالة مساعدة لتوليد التوكنز المزدوجة (Access & Refresh)
// ==========================================
const generateTokens = (userId, sessionId) => {
  const accessToken = jwt.sign(
    { id: userId, session_id: sessionId },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    { id: userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '30d' }
  );

  return { accessToken, refreshToken };
};

// ==========================================
// 🚀 1. تسجيل مالك جديد وتأسيس النظام
// ==========================================
const registerOwner = asyncHandler(async (req, res, next) => {
  const { owner_name, phone, password, organization_name, branch_name, branch_location } = req.body;

  if (!owner_name || !phone || !password || !organization_name || !branch_name || !branch_location) {
    return next(new AppError('جميع الحقول مطلوبة لتأسيس النظام', 400));
  }

  const existingUser = await User.findOne({ phone }).lean(); // .lean() لسرعة الفحص
  if (existingUser) {
    return next(new AppError('رقم الموبايل دا مسجل بالفعل في النظام ,استخدم رقم موبايل مختلف', 400));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. إنشاء المؤسسة
    const [organization] = await Organization.create([{ name: organization_name, owner_name, phone }], { session });

    // 2. إنشاء الفرع
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    const [branch] = await Branch.create([{
      organization_id: organization._id,
      name: branch_name,
      location: branch_location,
      subscription_status: 'TRIAL',
      monthly_fee: 0,
      trial_ends_at: trialEndsAt,
    }], { session });

    // 3. تأمين الباسورد
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);
    const sessionId = crypto.randomBytes(16).toString('hex');

    // 4. 🚀 إنشاء المستخدم (المالك) أولاً قبل توليد التوكنز
    const [user] = await User.create([{
      organization_id: organization._id,
      branch_id: null,
      name: owner_name,
      role: 'OWNER',
      phone,
      password_hash,
      current_session_id: sessionId,
      status: 'ACTIVE',
    }], { session });

   // 5. الآن نولد التوكنز باستخدام الـ ID الحقيقي للمستخدم
    const { accessToken, refreshToken } = generateTokens(user._id, sessionId);
    
    // 🛡️ SECURITY FIX: تشفير توكن التجديد قبل حفظه في قاعدة البيانات
    const refreshSalt = await bcrypt.genSalt(10);
    user.refresh_token = await bcrypt.hash(refreshToken, refreshSalt);
    await user.save({ session });

    // 6. اعتماد العملية
    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      message: 'تم إنشاء حساب المالك بنجاح',
      token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        organization_id: user.organization_id,
      },
      branch: {
        id: branch._id,
        name: branch.name,
        status: branch.subscription_status,
        trial_ends_at: branch.trial_ends_at,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    // تمرير الخطأ لصائد الأخطاء المركزي
    return next(new AppError('حدث خطأ داخلي أثناء التأسيس، تم التراجع عن العملية بأمان', 500));
  }
});

// ==========================================
// 🔐 2. تسجيل الدخول (للمالك والعامل معاً)
// ==========================================
const login = asyncHandler(async (req, res, next) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return next(new AppError('رقم الهاتف وكلمة المرور مطلوبان', 400));
  }

  const user = await User.findOne({ phone, deleted_at: null }).select('+password_hash');

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return next(new AppError('بيانات الدخول غير صحيحة', 401));
  }

  if (user.status !== 'ACTIVE') {
    return next(new AppError('هذا الحساب معطل حالياً، راجع الإدارة', 403));
  }

  const newSessionId = crypto.randomBytes(16).toString('hex');
  const { accessToken, refreshToken } = generateTokens(user._id, newSessionId);

  user.current_session_id = newSessionId;
  user.refresh_token = refreshToken;
  await user.save();

  res.status(200).json({
    message: 'تم تسجيل الدخول بنجاح',
    token: accessToken,
    refresh_token: refreshToken,
    user: {
      id: user._id,
      name: user.name,
      role: user.role,
      organization_id: user.organization_id,
      branch_id: user.branch_id,
    },
  });
});

// ==========================================
// ♻️ 3. تجديد الجلسة الصامت (Silent Refresh)
// ==========================================
const refreshToken = asyncHandler(async (req, res, next) => {
  const { refresh_token } = req.body;

  if (!refresh_token) {
    return next(new AppError('توكن التجديد مفقود، يرجى تسجيل الدخول مجدداً', 401));
  }

  try {
    const decoded = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);

    // 1. جلب المستخدم مع التوكن المشفر
    const user = await User.findById(decoded.id).select('+refresh_token');

    if (!user || !user.refresh_token) {
      return next(new AppError('غير مصرح', 403));
    }

    // 2. مقارنة التوكن المرسل بالتوكن المشفر في قاعدة البيانات
    const isValidToken = await bcrypt.compare(refresh_token, user.refresh_token);
    if (!isValidToken) {
       return next(new AppError('توكن التجديد غير صالح أو تم تسجيل الدخول من جهاز آخر', 403));
    }

    // ==========================================
    // 🚀 SECURITY & UX FIX: إيقاف الـ Rotation لمنع خروج المستخدم على الموبايل
    // ==========================================
    // نكتفي بتوليد Access Token جديد فقط (مدته 15 دقيقة)
    const currentSessionId = user.current_session_id || crypto.randomBytes(16).toString('hex');
    
    const newAccessToken = jwt.sign(
      { id: user._id, session_id: currentSessionId },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    // 🛡️ لا نقوم بتوليد Refresh Token جديد ولا نقوم بالكتابة على الداتابيز
    // هذا يمنع الـ (Desync) لو انقطع الإنترنت أثناء التجديد، ويجعل الجلسة مستقرة 100%

    res.status(200).json({
      token: newAccessToken,
      refresh_token: refresh_token, // 👈 نعيد نفس توكن التجديد القديم كما هو للمتصفح
    });

  } catch (error) {
    return next(new AppError('انتهت صلاحية الجلسة بالكامل (30 يوم)، يرجى تسجيل الدخول من جديد', 403));
  }
});

module.exports = {
  registerOwner,
  login,
  refreshToken,
};