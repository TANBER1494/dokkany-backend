const Product = require('../models/Product');
const Category = require('../models/Category');
const Branch = require('../models/Branch');
const exceljs = require('exceljs');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const mongoose = require('mongoose');

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

// ==========================================
// 📥 5. تصدير قالب إكسيل ذكي (مع قوائم منسدلة للأقسام)
// ==========================================
const exportExcelTemplate = asyncHandler(async (req, res, next) => {
  const { branch_id } = req.query;
  const ownerOrgId = req.user.organization_id;

  if (!branch_id) {
    return next(new AppError('يجب تحديد الفرع لتصدير القالب', 400));
  }

  // 1. جلب الأقسام الخاصة بهذا الفرع
  const categories = await Category.find({ branch_id, deleted_at: null }).select('name').lean();
  const categoryNames = categories.map(c => c.name);

  // 2. إنشاء ملف الإكسيل
  const workbook = new exceljs.Workbook();
  workbook.creator = 'Dokkany ERP';
  
  // ورقة العمل الرئيسية
  const worksheet = workbook.addWorksheet('إضافة المنتجات', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] // تجميد الصف الأول وتوجيه اليمين لليسار 🚀
  });

  // ورقة عمل مخفية (لتخزين الداتا الخاصة بالقوائم المنسدلة لتجاوز حد الـ 255 حرف)
  const dataSheet = workbook.addWorksheet('System_Data', { state: 'hidden' });

  // تعبئة الورقة المخفية بأسماء الأقسام
  if (categoryNames.length > 0) {
    categoryNames.forEach((name, index) => {
      dataSheet.getCell(`A${index + 1}`).value = name;
    });
  } else {
    dataSheet.getCell('A1').value = 'بدون تصنيف';
  }

  // 3. تعريف الأعمدة
  worksheet.columns = [
    { header: 'اسم المنتج (مطلوب)', key: 'name', width: 30 },
    { header: 'القسم (اختر من القائمة)', key: 'category', width: 25 },
    { header: 'الباركود (مطلوب)', key: 'barcode', width: 20 },
    { header: 'وحدة القياس', key: 'unit_type', width: 15 },
    { header: 'سعر الشراء (مطلوب)', key: 'purchase_price', width: 20 },
    { header: 'سعر البيع (مطلوب)', key: 'selling_price', width: 20 },
    { header: 'رصيد المخزن (مطلوب)', key: 'stock_quantity', width: 20 },
    { header: 'حد النواقص', key: 'min_stock', width: 15 }
  ];

  // 4. تلوين وتنسيق صف العناوين (الهيدر)
  worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
  worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } }; // لون إنديجو أنيق
  worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  worksheet.getRow(1).height = 30;

  // 5. تطبيق قواعد التحقق (Data Validation) لـ 500 صف
  const maxRows = 500;
  for (let i = 2; i <= maxRows + 1; i++) {
    // قائمة منسدلة للأقسام (تقرأ من الورقة المخفية)
    worksheet.getCell(`B${i}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`System_Data!$A$1:$A$${Math.max(categoryNames.length, 1)}`],
      showErrorMessage: true,
      errorTitle: 'قسم غير صالح',
      error: 'يرجى اختيار القسم من القائمة المنسدلة فقط'
    };

    // قائمة منسدلة لوحدات القياس
    worksheet.getCell(`D${i}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"قطعة,كرتونة,كيلو,جرام,لتر,علبة"']
    };

    // منع إدخال أرقام سالبة في الأسعار والكميات
    ['E', 'F', 'G', 'H'].forEach(col => {
      worksheet.getCell(`${col}${i}`).dataValidation = {
        type: 'decimal',
        operator: 'greaterThanOrEqual',
        formulae: [0],
        allowBlank: true,
        showErrorMessage: true,
        errorTitle: 'قيمة غير صالحة',
        error: 'يجب أن يكون الرقم أكبر من أو يساوي صفر'
      };
    });

    // تنسيق الخلايا لتكون في المنتصف
    worksheet.getRow(i).alignment = { vertical: 'middle', horizontal: 'center' };
  }

  // 6. إرسال الملف للمتصفح
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=Dokkany-Products-Template.xlsx`);

  await workbook.xlsx.write(res);
  res.end();
});


// ==========================================
// 🚀 6. استيراد المنتجات من ملف إكسيل (Bulk Import with ACID Transaction)
// ==========================================
const importProductsFromExcel = asyncHandler(async (req, res, next) => {
  if (!req.file) return next(new AppError('الرجاء رفع ملف الإكسيل', 400));
  
  const branch_id = req.user.role === 'CASHIER' ? req.user.branch_id : req.body.branch_id;
  const orgId = req.user.organization_id;

  if (!branch_id) return next(new AppError('معرف الفرع مطلوب', 400));

  const branchExists = await Branch.exists({ _id: branch_id, organization_id: orgId });
  if (!branchExists) return next(new AppError('الفرع غير صالح', 403));

  // 1. قراءة الملف من الذاكرة (Memory Buffer)
  const workbook = new exceljs.Workbook();
  await workbook.xlsx.load(req.file.buffer);
  const worksheet = workbook.getWorksheet(1); // قراءة الشيت الأولى

  if (!worksheet) return next(new AppError('ملف الإكسيل فارغ أو غير صالح', 400));

  // 2. التجهيز للأداء العالي (Memory Mapping)
  const existingCategories = await Category.find({ branch_id, deleted_at: null }).select('name _id').lean();
  const categoryMap = new Map(); // Map للبحث السريع جداً عن الـ ID بمعلومية الاسم
  existingCategories.forEach(c => categoryMap.set(c.name, c._id));

  const existingProducts = await Product.find({ branch_id, deleted_at: null }).select('barcode').lean();
  const existingBarcodes = new Set(existingProducts.map(p => p.barcode)); // Set لمنع التكرار بسرعة O(1)

  const newCategoriesToCreate = new Map(); 
  const productsToInsert = [];
  const errors = [];

  // 3. تحليل سطور الإكسيل (تخطي صف العناوين رقم 1)
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const name = row.getCell(1).value?.toString().trim();
    let categoryName = row.getCell(2).value?.toString().trim();
    const barcode = row.getCell(3).value?.toString().trim();
    const unit_type = row.getCell(4).value?.toString().trim() || 'قطعة';
    const purchase_price = Number(row.getCell(5).value);
    const selling_price = Number(row.getCell(6).value);
    const stock_quantity = Number(row.getCell(7).value);

    // 🛡️ التحقق من صحة البيانات لكل سطر (Data Validation)
    if (!name || !barcode || isNaN(purchase_price) || isNaN(selling_price) || isNaN(stock_quantity)) {
      errors.push(`صف ${rowNumber}: بيانات أساسية مفقودة أو غير صحيحة.`);
      return; // تخطي السطر الفاسد وإكمال الباقي
    }

    if (purchase_price < 0 || selling_price < 0 || stock_quantity < 0) {
      errors.push(`صف ${rowNumber}: لا يمكن إدخال قيم سالبة للمنتج (${name}).`);
      return;
    }

    if (existingBarcodes.has(barcode)) {
      errors.push(`صف ${rowNumber}: الباركود (${barcode}) مسجل مسبقاً في هذا الفرع.`);
      return;
    }

    if (!categoryName) categoryName = 'بدون تصنيف';

    // 🏷️ تجهيز الأقسام الجديدة إن وُجدت (لو كتب المستخدم اسماً جديداً في الإكسيل)
    if (!categoryMap.has(categoryName) && !newCategoriesToCreate.has(categoryName)) {
      newCategoriesToCreate.set(categoryName, { branch_id, name: categoryName });
    }

    // 📦 وضع المنتج في مصفوفة الانتظار
    productsToInsert.push({
      rowNumber, branch_id, tempCategoryName: categoryName,
      barcode, name, unit_type, purchase_price, selling_price, stock_quantity
    });

    existingBarcodes.add(barcode); // حماية ضد تكرار الباركود داخل ملف الإكسيل نفسه!
  });

  if (productsToInsert.length === 0) {
    return res.status(400).json({ message: 'لم يتم العثور على أي منتجات صالحة للإضافة', errors });
  }

  // 4. قاعدة البيانات - تنفيذ المعاملة (ACID Transaction)
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // أ. حفظ الأقسام الجديدة أولاً (Bulk Insert)
    if (newCategoriesToCreate.size > 0) {
      const newCats = Array.from(newCategoriesToCreate.values());
      const createdCats = await Category.insertMany(newCats, { session });
      createdCats.forEach(c => categoryMap.set(c.name, c._id)); // تحديث الخريطة بالـ IDs الجديدة
    }

    // ب. ربط المنتجات بالـ Category IDs وتجهيزها
    const finalProducts = productsToInsert.map(p => ({
      branch_id: p.branch_id,
      category_id: categoryMap.get(p.tempCategoryName), // 👈 الربط السحري
      barcode: p.barcode,
      name: p.name,
      unit_type: p.unit_type,
      purchase_price: p.purchase_price,
      selling_price: p.selling_price,
      stock_quantity: p.stock_quantity
    }));

    // ج. إدخال كل المنتجات دفعة واحدة (أسرع بـ 100 مرة من الإدخال الفردي)
    await Product.insertMany(finalProducts, { session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      message: 'تمت عملية الاستيراد بنجاح',
      summary: {
        success_count: finalProducts.length,
        failed_count: errors.length,
        new_categories_created: newCategoriesToCreate.size,
        errors // نرسلها للفرونت إند ليراها المالك ويصلحها
      }
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
});

module.exports = { addProduct, getProducts, updateProduct, deleteProduct, exportExcelTemplate, importProductsFromExcel };