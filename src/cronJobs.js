const cron = require('node-cron');
const Shift = require('./models/Shift');
const Branch = require('./models/Branch');
const Notification = require('./models/Notification');
const socket = require('./models/socket'); 

const startCronJobs = () => {
  // ==========================================
  // ⏱️ الوظيفة 1: تنبيه الكاشير قبل نهاية الوردية بـ 20 دقيقة
  // (تعمل كل دقيقة)
  // ==========================================
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const targetTime = new Date(now.getTime() + 20 * 60000);
      const targetHour = targetTime.getHours();
      const targetMinute = targetTime.getMinutes();

      const branches = await Branch.find({ 
        subscription_status: { $in: ['ACTIVE', 'TRIAL'] } 
      });

      for (const branch of branches) {
        if (!branch.shift_start_time || !branch.shift_duration_hours) continue;

        const [startH, startM] = branch.shift_start_time.split(':').map(Number);
        const duration = branch.shift_duration_hours;

        let deadlines = [];
        let currentH = startH;
        const shiftsPerDay = Math.floor(24 / duration);
        
        for (let i = 0; i < shiftsPerDay; i++) {
          deadlines.push({ h: currentH, m: startM });
          currentH = (currentH + duration) % 24;
        }

        const isDeadlineApproaching = deadlines.some(d => d.h === targetHour && d.m === targetMinute);

        if (isDeadlineApproaching) {
          const activeShift = await Shift.findOne({ 
            branch_id: branch._id, 
            status: 'OPEN' 
          }).populate('acknowledged_by');

          if (activeShift) {
            const cashierId = activeShift.acknowledged_by ? activeShift.acknowledged_by._id : activeShift.cashier_id;
            
            const notification = await Notification.create({
              organization_id: branch.organization_id,
              branch_id: branch._id,
              target_role: 'CASHIER',
              target_user_id: cashierId,
              title: 'تنبيه: اقتراب موعد تسليم الوردية ⏳',
              message: `متبقي 20 دقيقة على موعد انتهاء ورديتك الأساسية. يرجى مراجعة فواتيرك وجرد الدرج استعداداً لتسليم العهدة.`,
              type: 'SHIFT_ALERT',
              link: '/cashier/shift'
            });

            try {
              const io = socket.getIO();
              io.to(cashierId.toString()).emit('new_notification', notification);
            } catch (socketErr) {}
          }
        }
      }
    } catch (error) {
      console.error('Shift Alert Cron Error:', error);
    }
  });

  // ==========================================
  // 💳 [جديد] الوظيفة 2: تنبيه انتهاء الاشتراك قبل 5 أيام
  // (تعمل يومياً الساعة 10:00 صباحاً)
  // ==========================================
  cron.schedule('0 10 * * *', async () => {
    try {
      console.log('⏱️ Checking branch subscriptions...');
      const now = new Date();
      
      // حساب تاريخ اليوم + 5 أيام بالضبط
      const fiveDaysLater = new Date();
      fiveDaysLater.setDate(now.getDate() + 5);
      
      // بداية ونهاية ذلك اليوم للبحث بدقة
      const startOfTargetDay = new Date(fiveDaysLater.setHours(0, 0, 0, 0));
      const endOfTargetDay = new Date(fiveDaysLater.setHours(23, 59, 59, 999));

      // جلب الفروع التي ينتهي اشتراكها (تجريبي أو مدفوع) في هذا اليوم
      const branchesToWarn = await Branch.find({
        subscription_status: { $in: ['ACTIVE', 'TRIAL'] },
        $or: [
          { trial_ends_at: { $gte: startOfTargetDay, $lte: endOfTargetDay } },
          { subscription_ends_at: { $gte: startOfTargetDay, $lte: endOfTargetDay } }
        ]
      });

      for (const branch of branchesToWarn) {
        // تسجيل الإشعار للمالك
        const notification = await Notification.create({
          organization_id: branch.organization_id,
          branch_id: branch._id,
          target_role: 'OWNER',
          title: 'تنبيه: اقتراب انتهاء الاشتراك 💳',
          message: `فرع (${branch.name}) سينتهي اشتراكه خلال 5 أيام. يرجى التجديد لضمان عدم توقف الخدمة.`,
          type: 'SYSTEM',
          link: '/owner/billing'
        });

        // البث اللحظي للمالك
        try {
          const io = socket.getIO();
          io.to(branch.organization_id.toString()).emit('new_notification', notification);
        } catch (socketErr) {}
      }
    } catch (error) {
      console.error('Subscription Cron Error:', error);
    }
  });
};

module.exports = startCronJobs;