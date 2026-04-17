require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');

// استدعاء ملفات الـ Routes
const authRoutes = require('./routes/authRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const productRoutes = require('./routes/productRoutes');
const shiftRoutes = require('./routes/shiftRoutes');
const cashFlowRoutes = require('./routes/cashFlowRoutes');
const vendorRoutes = require('./routes/vendorRoutes');
const vendorInvoiceRoutes = require('./routes/vendorInvoiceRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const payrollRoutes = require('./routes/payrollRoutes');
const customerDebtRoutes = require('./routes/customerDebtRoutes');
const branchRoutes = require('./routes/branchRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const platformPaymentRoutes = require('./routes/platformPaymentRoutes');
const posAccountRoutes = require('./routes/posAccountRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const startCronJobs = require('./cronJobs');
const notificationRoutes = require('./routes/notificationRoutes');
const adminRoutes = require('./routes/adminRoutes');  

const app = express();
connectDB();

// ==========================================
// 🛡️ 2. طبقات الحماية والأمن (Security Middlewares)
// ==========================================
// 🚀 [الضربة القاضية للثغرات] تعريف البروكسي للسيرفرات السحابية
app.set('trust proxy', 1);

app.use(helmet());

// إعدادات CORS صارمة
const allowedOrigins = [
  'http://localhost:5173', 
  'http://localhost:3000', 
  'http://localhost:19006', 
  process.env.CLIENT_URL 
].filter(Boolean); // لتنظيف أي مسارات فارغة

app.use(cors({
  origin: function (origin, callback) {
    // السماح للطلبات بدون Origin (تطبيقات الموبايل أو Postman) في بيئة التطوير فقط
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('إجراء أمني: غير مصرح لك بالوصول - CORS Policy'));
    }
  },
  credentials: true 
}));

// Rate Limit عام
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 1000, 
  message: 'تم تجاوز الحد المسموح من الطلبات، يرجى المحاولة بعد قليل'
});
app.use('/api', generalLimiter);

// Rate Limit صارم جداً للـ Login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 10, // تم رفعها لـ 10 لتجنب حظر المالك أثناء الاختبار
  message: 'محاولات تسجيل دخول كثيرة جداً، تم حظر جهازك مؤقتاً لمدة ربع ساعة.'
});
app.use('/api/auth/login', loginLimiter);

app.use(express.json({ limit: '10kb' })); 
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// حماية متقدمة
app.use(hpp()); 

// 🛡️ إصلاح معماري متقدم (Express 5 Compatibility)
// نستخدم مكتبة mongoSanitize بطريقة (In-place Mutation) لتنظيف البيانات من حقن قواعد البيانات
// دون محاولة استبدال كائنات req المحمية في Express 5، واستغنينا عن xss-clean لتكفل React بحماية الفرونت إند.
app.use((req, res, next) => {
  if (req.body) mongoSanitize.sanitize(req.body, { replaceWith: '_' });
  if (req.query) mongoSanitize.sanitize(req.query, { replaceWith: '_' });
  if (req.params) mongoSanitize.sanitize(req.params, { replaceWith: '_' });
  next();
});

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ==========================================
// 🌐 3. توجيه المسارات (API Routes)
// ==========================================
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'success', message: 'Dokkany Enterprise API is running securely!' });
});

app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/cash-flows', cashFlowRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/vendor-invoices', vendorInvoiceRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/customer-debts', customerDebtRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/payments', platformPaymentRoutes);
app.use('/api/pos-accounts', posAccountRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);
// ==========================================
// 🚀 4. معالجة الأخطاء الشاملة (Global Error Handling)
// ==========================================
app.use((err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // 🚀 [الحل الاحترافي] التقاط أخطاء الـ ObjectId غير الصالحة وتحويلها لخطأ 400
  if (err.name === 'CastError' && err.kind === 'ObjectId') {
    err.statusCode = 400;
    err.message = `بيانات غير صالحة: المعرّف (${err.value}) ليس بصيغة صحيحة.`;
  }

  if (process.env.NODE_ENV === 'development') {
    console.error('🔥 Error:', err.message);
  }

  res.status(err.statusCode).json({
    status: err.status,
    message: err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ==========================================
// 🚀 5. تشغيل السيرفر وتفعيل (Socket.io)
// ==========================================
const http = require('http');
const socket = require('./models/socket'); 

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
const io = socket.init(server);

io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);
  socket.on('joinRoom', (room) => {
    socket.join(room);
    console.log(`🏠 Socket ${socket.id} joined room: ${room}`);
  });
  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Dokkany Server running securely in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  startCronJobs(); 
});

// 🚀 [جديد] حماية السيرفر من السقوط بسبب أخطاء خارج Express
process.on('unhandledRejection', (err) => {
  console.log('💥 UNHANDLED REJECTION! Shutting down gracefully...');
  console.log(err.name, err.message);
  server.close(() => {
    process.exit(1);
  });
});