const Category = require('../models/Category');
const Branch = require('../models/Branch');
const Product = require('../models/Product');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// ➕ 1. إضافة فئة جديدة
// ==========================================
const addCategory = asyncHandler(async (req, res, next) => {
  const { name, description, branch_id } = req.body;
  const ownerOrgId = req.user.organization_id;

  if (!name || !branch_id)
    return next(new AppError('اسم الفئة ومعرف الفرع مطلوبان', 400));

  const branch = await Branch.findOne({
    _id: branch_id,
    organization_id: ownerOrgId,
  }).lean();
  if (!branch)
    return next(
      new AppError('الفرع المحدد غير صالح أو لا تملك صلاحية عليه', 403)
    );

  const existingCategory = await Category.findOne({
    branch_id,
    name: name.trim(),
    deleted_at: null,
  }).lean();
  if (existingCategory)
    return next(new AppError('توجد فئة بنفس الاسم مسبقاً في هذا الفرع', 400));

  const newCategory = await Category.create({
    branch_id,
    name: name.trim(),
    description: description ? description.trim() : null,
  });

  res
    .status(201)
    .json({ message: 'تم إضافة الفئة بنجاح', category: newCategory });
});

// ==========================================
// 📋 2. جلب جميع الفئات لفرع معين
// ==========================================
const getCategories = asyncHandler(async (req, res, next) => {
  const { branch_id } = req.query;
  const ownerOrgId = req.user.organization_id;

  if (!branch_id)
    return next(new AppError('يجب تحديد الفرع (branch_id) لعرض الفئات', 400));

  const branch = await Branch.exists({
    _id: branch_id,
    organization_id: ownerOrgId,
  });
  if (!branch)
    return next(new AppError('لا تملك صلاحية لعرض بيانات هذا الفرع', 403));

  // 🚀 استخدام lean() للسرعة القصوى
  const categories = await Category.find({ branch_id, deleted_at: null })
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json({ categories });
});

// ==========================================
// ✏️ 3. تعديل اسم أو وصف الفئة
// ==========================================
const updateCategory = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name, description } = req.body;
  const ownerOrgId = req.user.organization_id;

  const category = await Category.findOne({ _id: id, deleted_at: null });
  if (!category) return next(new AppError('الفئة غير موجودة', 404));

  const branch = await Branch.exists({
    _id: category.branch_id,
    organization_id: ownerOrgId,
  });
  if (!branch) return next(new AppError('لا تملك صلاحية تعديل هذه الفئة', 403));

  if (name && name.trim() !== category.name) {
    const duplicate = await Category.exists({
      branch_id: category.branch_id,
      name: name.trim(),
      deleted_at: null,
      _id: { $ne: id },
    });
    if (duplicate)
      return next(new AppError('هذا الاسم مستخدم لفئة أخرى بالفعل', 400));
    category.name = name.trim();
  }

  if (description !== undefined) category.description = description.trim();

  await category.save();
  res.status(200).json({ message: 'تم تحديث الفئة بنجاح', category });
});

// ==========================================
// 🗑️ 4. حذف فئة (مع تطبيق قاعدة المنع الصارمة)
// ==========================================
const deleteCategory = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const ownerOrgId = req.user.organization_id;

  const category = await Category.findOne({ _id: id, deleted_at: null });
  if (!category) return next(new AppError('الفئة غير موجودة', 404));

  const branch = await Branch.exists({
    _id: category.branch_id,
    organization_id: ownerOrgId,
  });
  if (!branch) return next(new AppError('لا تملك صلاحية حذف هذه الفئة', 403));

  const activeProductsCount = await Product.countDocuments({
    category_id: id,
    deleted_at: null,
  });
  if (activeProductsCount > 0) {
    return next(
      new AppError(
        `لا يمكن حذف الفئة لاحتوائها على (${activeProductsCount}) منتجات نشطة.`,
        400
      )
    );
  }

  category.deleted_at = new Date();
  await category.save();

  res.status(200).json({ message: 'تم حذف الفئة بنجاح' });
});

module.exports = { addCategory, getCategories, updateCategory, deleteCategory };
