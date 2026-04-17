const Product = require('../models/Product');
const Category = require('../models/Category');
const Branch = require('../models/Branch');

const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// ➕ 1. إضافة منتج جديد للمخزن
// ==========================================
const addProduct = asyncHandler(async (req, res, next) => {
  const { branch_id, category_id, barcode, name, unit_type, purchase_price, selling_price, stock_quantity, image_url } = req.body;
  const ownerOrgId = req.user.organization_id;

  const numPurchase = Number(purchase_price);
  const numSelling = Number(selling_price);
  const numStock = Number(stock_quantity);

  if (!branch_id || !category_id || !barcode || !name || isNaN(numPurchase) || isNaN(numSelling) || isNaN(numStock)) {
    return next(new AppError('الرجاء إكمال جميع بيانات المنتج الأساسية بشكل صحيح', 400));
  }

  // 🛡️ حماية صارمة ضد الأرقام السالبة (التي تدمر الحسابات)
  if (numPurchase < 0 || numSelling < 0 || numStock < 0) {
    return next(new AppError('لا يمكن أن تكون الأسعار أو الكمية قيماً سالبة', 400));
  }

  // 🚀 [Senior Move]: تنفيذ 3 استعلامات في نفس اللحظة لتوفير وقت السيرفر
  const [branchExists, categoryExists, duplicateBarcode] = await Promise.all([
    Branch.exists({ _id: branch_id, organization_id: ownerOrgId }),
    Category.exists({ _id: category_id, branch_id, deleted_at: null }),
    Product.exists({ branch_id, barcode: barcode.trim(), deleted_at: null })
  ]);

  if (!branchExists) return next(new AppError('الفرع المحدد غير صالح أو لا تتبع له', 403));
  if (!categoryExists) return next(new AppError('الفئة المحددة غير موجودة في هذا الفرع', 400));
  if (duplicateBarcode) return next(new AppError('هذا الباركود مستخدم لمنتج آخر نشط في نفس الفرع', 400));

  const newProduct = await Product.create({
    branch_id,
    category_id,
    barcode: barcode.trim(),
    name: name.trim(),
    unit_type: unit_type ? unit_type.trim() : 'قطعة',
    purchase_price: numPurchase,
    selling_price: numSelling,
    stock_quantity: numStock,
    image_url: image_url || null,
  });

  res.status(201).json({ message: 'تم إضافة المنتج للمخزن بنجاح', product: newProduct });
});

// ==========================================
// 📋 2. جلب المنتجات (محرك بحث سريع كطلقة الرصاص 🚀)
// ==========================================
const getProducts = asyncHandler(async (req, res, next) => {
  const { branch_id, category_id, search, barcode } = req.query;
  const ownerOrgId = req.user.organization_id;

  if (!branch_id) return next(new AppError('يجب تحديد الفرع لعرض المنتجات', 400));

  const branchExists = await Branch.exists({ _id: branch_id, organization_id: ownerOrgId });
  if (!branchExists) return next(new AppError('لا تملك صلاحية لعرض بضاعة هذا الفرع', 403));

  const query = { branch_id, deleted_at: null };
  if (category_id) query.category_id = category_id;
  if (barcode) query.barcode = barcode.trim();
  if (search) query.name = { $regex: search.trim(), $options: 'i' };

  // 🚀 استخدام .lean() يقلل استهلاك الرامات بنسبة 80% عند جلب آلاف المنتجات
  const products = await Product.find(query)
    .populate('category_id', 'name')
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json({ count: products.length, products });
});

// ==========================================
// ✏️ 3. تعديل بيانات منتج
// ==========================================
const updateProduct = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { category_id, barcode, name, unit_type, purchase_price, selling_price, stock_quantity, image_url } = req.body;
  const ownerOrgId = req.user.organization_id;

  const product = await Product.findOne({ _id: id, deleted_at: null });
  if (!product) return next(new AppError('المنتج غير موجود', 404));

  const branchExists = await Branch.exists({ _id: product.branch_id, organization_id: ownerOrgId });
  if (!branchExists) return next(new AppError('لا تملك صلاحية تعديل هذا المنتج', 403));

  if (category_id && category_id !== product.category_id.toString()) {
    const categoryCheck = await Category.exists({ _id: category_id, branch_id: product.branch_id, deleted_at: null });
    if (!categoryCheck) return next(new AppError('القسم الجديد غير صالح', 400));
    product.category_id = category_id;
  }

  if (barcode && barcode.trim() !== product.barcode) {
    const duplicateBarcode = await Product.exists({
      branch_id: product.branch_id, barcode: barcode.trim(), deleted_at: null, _id: { $ne: id }
    });
    if (duplicateBarcode) return next(new AppError('الباركود الجديد مستخدم لمنتج آخر', 400));
    product.barcode = barcode.trim();
  }

  if (name) product.name = name.trim();
  if (unit_type !== undefined) product.unit_type = unit_type.trim();
  
  // 🛡️ التحديث مع حماية الأرقام السالبة
  if (purchase_price !== undefined) {
    const num = Number(purchase_price);
    if (!isNaN(num) && num >= 0) product.purchase_price = num;
  }
  if (selling_price !== undefined) {
    const num = Number(selling_price);
    if (!isNaN(num) && num >= 0) product.selling_price = num;
  }
  if (stock_quantity !== undefined) {
    const num = Number(stock_quantity);
    if (!isNaN(num) && num >= 0) product.stock_quantity = num;
  }
  
  if (image_url !== undefined) product.image_url = image_url;

  await product.save();
  res.status(200).json({ message: 'تم تحديث بيانات المنتج بنجاح', product });
});

// ==========================================
// 🗑️ 4. حذف منتج (Soft Delete الآمن)
// ==========================================
const deleteProduct = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const ownerOrgId = req.user.organization_id;

  const product = await Product.findOne({ _id: id, deleted_at: null });
  if (!product) return next(new AppError('المنتج غير موجود', 404));

  const branchExists = await Branch.exists({ _id: product.branch_id, organization_id: ownerOrgId });
  if (!branchExists) return next(new AppError('لا تملك صلاحية لحذف هذا المنتج', 403));

  product.deleted_at = new Date();
  // تحرير الباركود لكي يمكن استخدامه مستقبلاً
  product.barcode = `${product.barcode}_del_${Date.now()}`;

  await product.save();
  res.status(200).json({ message: 'تم إزالة المنتج من المخزن بنجاح' });
});

module.exports = { addProduct, getProducts, updateProduct, deleteProduct };