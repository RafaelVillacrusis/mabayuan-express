const pool = require('../db');
const { emitResidentNotification, emitRoleRefresh, emitRoleNotification, emitBroadcastNotification } = require('../node/realtime');
const { createAuditLog } = require('./audit.actions');

async function createResidentNotification({
  residentId,
  requestId = null,
  title,
  message,
  actorUserId = null,
  actorRole = null,
  eventType = 'NOTIFICATION_SENT',
  auditMeta = null
}) {
  // ✅ PostgreSQL INSERT with RETURNING
  const { rows } = await pool.query(
    `INSERT INTO notifications (resident_id, request_id, title, message)
     VALUES ($1, $2, $3, $4)
     RETURNING notification_id, created_at`,
    [residentId, requestId, title, message]
  );

  const notification = rows[0];

  const payload = {
    notification_id: notification.notification_id,
    resident_id: residentId,
    request_id: requestId,
    title,
    message,
    is_read: false,
    created_at: notification.created_at
  };

  await createAuditLog({
    actorUserId,
    actorRole,
    targetType: requestId ? 'request_notification' : 'resident_notification',
    targetId: requestId || residentId,
    action: eventType,
    description: `Notification sent to resident #${residentId}: ${title}`,
    metadata: {
      resident_id: residentId,
      request_id: requestId,
      title,
      message,
      ...(auditMeta || {})
    }
  });

  emitResidentNotification(residentId, payload);
  return payload;
}

async function getResidentNotifications(residentId) {
  const { rows } = await pool.query(
    `SELECT *
     FROM notifications
     WHERE resident_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [residentId]
  );
  return rows;
}

async function markNotificationsRead(residentId) {
  await pool.query(
    `UPDATE notifications
     SET is_read = true
     WHERE resident_id = $1 AND is_read = false`,
    [residentId]
  );
}

function refreshRoleDashboards(...roles) {
  roles.forEach((role) => emitRoleRefresh(role));
}

/**
 * Send a captain broadcast message to: 'resident', 'staff', or 'all'.
 * Inserts into captain_messages table and emits real-time notifications.
 */
async function sendCaptainMessage({ captainUserId, targetAudience, subject, body }) {
  // Persist to captain_messages table
  const { rows } = await pool.query(
    `INSERT INTO captain_messages (captain_user_id, target_audience, subject, body)
     VALUES ($1, $2, $3, $4)
     RETURNING message_id, created_at`,
    [captainUserId, targetAudience, subject, body]
  );
  const msg = rows[0];

  const payload = {
    notification_id: `msg_${msg.message_id}`,
    title: `📢 Captain: ${subject}`,
    message: body,
    is_read: false,
    created_at: msg.created_at,
    from_captain: true
  };

  // Emit real-time to the right audience
  if (targetAudience === 'all') {
    // Notify residents (all connected resident sockets via broadcast)
    emitBroadcastNotification(payload);
    // Also push to staff and resident role rooms
    emitRoleNotification('staff', payload);
    emitRoleNotification('resident', payload);
  } else if (targetAudience === 'staff') {
    emitRoleNotification('staff', payload);
  } else if (targetAudience === 'resident') {
    // Broadcast to all residents in resident: rooms via general broadcast
    // We target the 'resident' role room (residents join this on login)
    emitRoleNotification('resident', payload);
  }

  await createAuditLog({
    actorUserId: captainUserId,
    actorRole: 'captain',
    targetType: 'captain_message',
    targetId: msg.message_id,
    action: 'CAPTAIN_MESSAGE_SENT',
    description: `Captain sent message "${subject}" to audience: ${targetAudience}.`,
    metadata: { target_audience: targetAudience, subject, body }
  });

  return msg;
}

async function getCaptainMessages({ limit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT cm.message_id, cm.target_audience, cm.subject, cm.body, cm.created_at,
            u.full_name AS captain_name
     FROM captain_messages cm
     LEFT JOIN users u ON u.user_id = cm.captain_user_id
     ORDER BY cm.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

async function getInboxMessages(role, limit = 100) {
  const audience = role === 'resident' ? ['resident', 'all'] : ['staff', 'all'];
  const { rows } = await pool.query(
    `SELECT cm.message_id, cm.target_audience, cm.subject, cm.body, cm.created_at,
            u.full_name AS captain_name
     FROM captain_messages cm
     LEFT JOIN users u ON u.user_id = cm.captain_user_id
     WHERE cm.target_audience = ANY($1)
     ORDER BY cm.created_at DESC
     LIMIT $2`,
    [audience, limit]
  );
  return rows;
}

module.exports = {
  createResidentNotification,
  getResidentNotifications,
  markNotificationsRead,
  refreshRoleDashboards,
  sendCaptainMessage,
  getCaptainMessages,
  getInboxMessages
};