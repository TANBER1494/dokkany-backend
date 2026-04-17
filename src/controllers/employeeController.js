const User = require('../models/User');
const Branch = require('../models/Branch');
const bcrypt = require('bcryptjs');

const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// ➕ 1. إضافة عامل/كاشير 
// ==========================================
const addEmployee = asyncHandler(async (req, res, next) => {
  const { name, phone, employee_title, branch_id, daily_wage, pin_code } = req.body;
  const ownerOrgId = req.user.organization_id;

  if (!['CASHIER', 'FLOOR_WORKER'].includes(employee_title)) {
    return next(new AppError('المسمى الوظيفي غير صالح', 400));
  }

  const wageNum = Number(daily_wage);
  if (isNaN(wageNum) || wageNum < 0) {
    return next(new AppError('الأجر اليومي يجب أن يكون رقماً صحيحاً (صفر أو أكثر)', 400));
  }

  // 🛡️ لوجيك الـ PIN (مخصص فقط لحماية استلام الوردية، وليس لتسجيل الدخول)
  let hashedPin = undefined;
  if (employee_title === 'CASHIER') {
    if (!pin_code || !/^\d{4}$/.test(pin_code)) {
      return next(new AppError('يجب تعيين رمز PIN من 4 أرقام للكاشير لحماية استلام الوردية', 400));
    }
    const salt = await bcrypt.genSalt(10);
    hashedPin = await bcrypt.hash(pin_code, salt);
  }

  const branch = await Branch.exists({ _id: branch_id, organization_id: ownerOrgId });
  if (!branch) return next(new AppError('الفرع المحدد غير موجود أو لا تملك صلاحية عليه', 403));

  // الهاتف هنا مجرد وسيلة تواصل، ولكن نمنع تكراره تجنباً لأخطاء الداتابيز
  const existingUser = await User.exists({ phone });
  if (existingUser) return next(new AppError('رقم الهاتف مسجل لعامل آخر في النظام', 400));

  const newEmployee = await User.create({
    organization_id: ownerOrgId,
    branch_id,
    name: name.trim(),
    role: 'FLOOR_WORKER', // الصلاحية البرمجية الأساسية
    employee_title,       // المسمى الفعلي (كاشير / عامل أرضية)
    phone: phone.trim(),
    daily_wage: wageNum,
    pin_code: hashedPin   // 👈 حفظ الـ PIN مشفراً لتأمين استلام الخزينة
  });

  // إخفاء الـ PIN من الرد
  newEmployee.pin_code = undefined; 

  res.status(201).json({ message: 'تم إضافة العامل بنجاح', employee: newEmployee });
});

// ==========================================
// 📋 2. جلب العمال (Optimized)
// ==========================================
const getEmployees = asyncHandler(async (req, res, next) => {
  const orgId = req.user.organization_id;
  let branchId = req.query.branch_id;

  if (req.user.role === 'CASHIER') branchId = req.user.branch_id;

  const query = { organization_id: orgId, deleted_at: null, role: 'FLOOR_WORKER' };
  if (branchId) query.branch_id = branchId;

  // 🚀 استخدام .lean() و استبعاد الـ PIN والبيانات الحساسة
  const employees = await User.find(query)
    .select('-pin_code -password_hash -refresh_token')
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json({ count: employees.length, employees });
});

// ==========================================
// ✏️ 3. تعديل موظف (مع إدارة الـ PIN)
// ==========================================
const updateEmployee = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name, daily_wage, status, branch_id, employee_title, pin_code } = req.body;
  const ownerOrgId = req.user.organization_id;

  const employee = await User.findOne({ _id: id, organization_id: ownerOrgId, deleted_at: null, role: 'FLOOR_WORKER' });
  if (!employee) return next(new AppError('الموظف غير موجود', 404));

  if (name) employee.name = name.trim();
  if (status) employee.status = status;
  
  if (daily_wage !== undefined) {
    const wageNum = Number(daily_wage);
    if (!isNaN(wageNum) && wageNum >= 0) employee.daily_wage = wageNum;
  }
  
  if (employee_title) employee.employee_title = employee_title;

  // 🛡️ معالجة تحديث الـ PIN لتسليم الوردية
  if (pin_code) {
    if (!/^\d{4}$/.test(pin_code)) return next(new AppError('رمز الـ PIN يجب أن يكون 4 أرقام فقط', 400));
    const salt = await bcrypt.genSalt(10);
    employee.pin_code = await bcrypt.hash(pin_code, salt);
  } else if (employee.employee_title === 'CASHIER' && !employee.pin_code) {
     return next(new AppError('يجب تعيين رمز PIN من 4 أرقام عند ترقية العامل إلى كاشير لتأمين الدرج', 400));
  }

  // التحقق من نقل الموظف لفرع آخر
  if (branch_id && branch_id !== employee.branch_id.toString()) {
    const branchCheck = await Branch.exists({ _id: branch_id, organization_id: ownerOrgId });
    if (!branchCheck) return next(new AppError('الفرع الجديد غير صالح أو لا تتبع له', 403));
    employee.branch_id = branch_id;
  }

  await employee.save();
  employee.pin_code = undefined; // إخفاءه من الرد
  res.status(200).json({ message: 'تم تحديث بيانات الموظف بنجاح', employee });
});

// ==========================================
// 🗑️ 4. حذف موظف (Soft Delete آمن)
// ==========================================
const deleteEmployee = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const ownerOrgId = req.user.organization_id;

  const employee = await User.findOne({ _id: id, organization_id: ownerOrgId, role: 'FLOOR_WORKER' });
  if (!employee || employee.deleted_at !== null) return next(new AppError('الموظف غير موجود مسبقاً', 404));

  employee.deleted_at = new Date();
  employee.status = 'TERMINATED';
  
  // تغيير رقم الهاتف بشكل عشوائي لإتاحة تسجيل عامل جديد بنفس الرقم مستقبلاً
  employee.phone = `${employee.phone}_term_${Date.now()}`;

  await employee.save();
  res.status(200).json({ message: 'تم إنهاء خدمة الموظف وإزالته بنجاح' });
});

module.exports = { addEmployee, getEmployees, updateEmployee, deleteEmployee };