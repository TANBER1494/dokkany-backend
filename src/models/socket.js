let io;

module.exports = {
  // تهيئة السيرفر
  init: (httpServer) => {
    const { Server } = require('socket.io');
    io = new Server(httpServer, {
      cors: {
        origin: '*', // سنقوم بتأمينه لاحقاً ليتوافق مع الـ Frontend
        methods: ['GET', 'POST']
      }
    });
    return io;
  },
  // استدعاء السيرفر من أي كنترولر
  getIO: () => {
    if (!io) {
      throw new Error('Socket.io لم يتم تهيئته بعد!');
    }
    return io;
  }
};