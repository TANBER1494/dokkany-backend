// src/utils/AppError.js
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true; // لتوضيح أن هذا الخطأ متوقع (مثل باسورد خطأ) وليس انهياراً في السيرفر

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;