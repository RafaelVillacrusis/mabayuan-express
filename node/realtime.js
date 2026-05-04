let ioInstance = null;

function initRealtime(io) {
  ioInstance = io;
  io.on('connection', (socket) => {
    socket.on('join:resident', (residentId) => {
      if (residentId) socket.join(`resident:${residentId}`);
    });

    socket.on('join:role', (role) => {
      if (role) socket.join(`role:${role}`);
    });
  });
}

function emitResidentNotification(residentId, payload) {
  if (!ioInstance || !residentId) return;
  ioInstance.to(`resident:${residentId}`).emit('notification:new', payload);
}

function emitRoleRefresh(role, payload = {}) {
  if (!ioInstance || !role) return;
  ioInstance.to(`role:${role}`).emit('dashboard:refresh', payload);
}

function emitRoleNotification(role, payload) {
  if (!ioInstance || !role) return;
  ioInstance.to(`role:${role}`).emit('notification:new', payload);
}

function emitBroadcastNotification(payload) {
  if (!ioInstance) return;
  // Send to all connected sockets
  ioInstance.emit('notification:new', payload);
}

module.exports = { initRealtime, emitResidentNotification, emitRoleRefresh, emitRoleNotification, emitBroadcastNotification };
