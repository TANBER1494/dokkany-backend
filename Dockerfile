# استخدام نسخة خفيفة من Node.js
FROM node:18-alpine

# تحديد مجلد العمل داخل الحاوية
WORKDIR /app

# نسخ ملفات الـ package وتثبيت الحزم
COPY package*.json ./
RUN npm install

# نسخ باقي ملفات المشروع
COPY . .

# 🚀 إجبار الحاوية على استخدام البورت الذي تطلبه منصة Hugging Face
EXPOSE 7860
ENV PORT=7860

# تشغيل السيرفر
CMD ["npm", "start"]