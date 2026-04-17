const mongoose = require('mongoose');

const branchSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'يجب ربط الفرع بمؤسسة (Organization)'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'اسم الفرع مطلوب'],
      trim: true,
    },
    location: {
      type: String,
      required: [true, 'موقع الفرع مطلوب'],
      trim: true,
    },
    subscription_status: {
      type: String,
      enum: ['TRIAL', 'ACTIVE', 'OVERDUE', 'LOCKED'],
      default: 'TRIAL',
      required: true,
    },
    monthly_fee: {
      type: Number,
      required: [true, 'يجب تحديد قيمة الاشتراك الشهري للفرع'],
      min: 0,
    },
    trial_ends_at: {
      type: Date,
      required: [true, 'تاريخ انتهاء الفترة التجريبية مطلوب'],
    },
    subscription_ends_at: {
      type: Date,
      default: null,
    },
   // 👇 --- حقول نظام الورديات والتنبيهات الجديدة --- 👇
    shift_start_time: {
      type: String,
      default: '08:00', 
      match: [/^([01]\d|2[0-3]):?([0-5]\d)$/, 'صيغة الوقت غير صحيحة، يجب أن تكون HH:mm'],
      required: [true, 'يجب تحديد وقت بدء الوردية الأولى (الصباحية)'],
    },
    shift_duration_hours: {
      type: Number,
      default: 12, 
      min: [1, 'مدة الوردية لا يمكن أن تقل عن ساعة'],
      max: [24, 'مدة الوردية لا يمكن أن تتجاوز 24 ساعة'],
      required: [true, 'يجب تحديد مدة الوردية بالساعات'],
    },
    // 🚀 [الجديد] مفتاح التحكم المزدوج في صلاحيات الكاشير
    is_deletion_allowed: {
      type: Boolean,
      default: true, // السماح بالمسح افتراضياً
    },
    deletion_window_minutes: {
      type: Number,
      default: 15, // مهلة 15 دقيقة افتراضياً
      min: [1, 'أقل مهلة مسموحة هي دقيقة واحدة'],
    }
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Branch', branchSchema);