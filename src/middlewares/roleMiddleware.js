const authorize = (...roles) => {
  return (req, res, next) => {
    // 🚀 [جديد] حماية من الانهيار إذا كان req.user غير معرف لسبب ما
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: `إجراء أمني: دورك الحالي (${req.user?.role || 'مجهول'}) لا يملك صلاحية لهذا الإجراء.` 
      });
    }
    next();
  };
};

module.exports = { authorize };