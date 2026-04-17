const Branch = require('../models/Branch');

const checkSubscription = async (req, res, next) => {
  try {
    if (req.user?.role === 'SUPER_ADMIN') return next();

    // ==========================================
    // 🛡️ 1. تحديد الفرع بصرامة شديدة حسب الصلاحية
    // ==========================================
    let branchId;
    
    if (req.user?.role === 'CASHIER') {
      // الكاشير لا يحق له تمرير ID من الفرونت إند إطلاقاً، نعتمد على ما في التوكن فقط
      branchId = req.user.branch_id; 
    } else {
      // المالك يحق له تمرير الـ ID في أي مكان في الطلب
      branchId = req.body?.branch_id || req.query?.branch_id || req.params?.branchId;
    }

    if (!branchId) {
      return res.status(400).json({ message: 'إجراء أمني: يجب تحديد الفرع لإتمام العملية.' });
    }

    // ==========================================
    // 🛡️ 2. منع اختراق الفروع (IDOR Protection)
    // ==========================================
    const query = { _id: branchId };
    
    // إذا كان مالكاً، نجبر البحث أن يكون الفرع تحت مؤسسته فقط!
    if (req.user?.role === 'OWNER') {
      query.organization_id = req.user.organization_id;
    }

    const branch = await Branch.findOne(query);

    if (!branch) {
      return res.status(403).json({ message: 'إجراء أمني: الفرع غير موجود أو أنك لا تملك صلاحية إدارية عليه.' });
    }

    const now = new Date();

    // 3. فحص الإغلاق الإداري
    if (branch.subscription_status === 'LOCKED') {
      return res.status(403).json({
        status: 'LOCKED',
        message: 'تم إغلاق هذا الفرع بقرار إداري، يرجى التواصل مع الدعم الفني.',
      });
    }

    // 4. فحص الفترة التجريبية
    if (branch.subscription_status === 'TRIAL') {
      if (now > branch.trial_ends_at) {
        branch.subscription_status = 'OVERDUE';
        await branch.save();
        return res.status(403).json({
          status: 'EXPIRED',
          message: 'انتهت الفترة التجريبية المجانية، يرجى تفعيل الاشتراك للاستمرار.',
        });
      }
    }

    // 5. فحص الاشتراك المدفوع
    if (branch.subscription_status === 'ACTIVE' || branch.subscription_status === 'OVERDUE') {
      if (branch.subscription_ends_at && now > branch.subscription_ends_at) {
        branch.subscription_status = 'OVERDUE';
        await branch.save();
        return res.status(403).json({
          status: 'EXPIRED',
          message: 'انتهت مدة الاشتراك المدفوع، يرجى السداد لتجنب توقف الخدمة.',
        });
      }
    }

    next();
  } catch (error) {
    console.error('Subscription Middleware Error:', error);
    res.status(500).json({ message: 'حدث خطأ أثناء الفحص الأمني للاشتراك.' });
  }
};

module.exports = { checkSubscription };