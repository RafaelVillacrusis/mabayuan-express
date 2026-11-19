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
// Real-time notification for an announcement that has just gone live
function announceMessage(msg) {
  const payload = {
    notification_id: `msg_${msg.message_id}`,
    title: `📢 Captain: ${msg.subject}`,
    message: msg.body,
    is_read: false,
    created_at: msg.publish_at || msg.created_at,
    from_captain: true
  };
  if (msg.target_audience === 'all') emitBroadcastNotification(payload); // reaches every connected user once
  else emitRoleNotification(msg.target_audience, payload);
  // Inbox pages and the landing page list refresh
  emitRoleRefresh('resident');
  emitRoleRefresh('staff');
  emitRoleRefresh('captain');
}

/**
 * Save an announcement. With a future publishAt it is scheduled (residents/staff
 * don't see it and aren't notified until then). expiresAt hides it afterwards.
 */
async function sendCaptainMessage({ captainUserId, targetAudience, subject, body, publishAt = null, expiresAt = null }) {
  const now = new Date();
  const scheduled = publishAt && publishAt > now;
  const { rows } = await pool.query(
    `INSERT INTO captain_messages (captain_user_id, target_audience, subject, body, publish_at, expires_at, notified_at)
     VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), $6, CASE WHEN $7 THEN NULL ELSE NOW() END)
     RETURNING message_id, target_audience, subject, body, created_at, publish_at, expires_at`,
    [captainUserId, targetAudience, subject, body, scheduled ? publishAt : null, expiresAt, !!scheduled]
  );
  const msg = rows[0];
  if (!scheduled) announceMessage(msg);

  await createAuditLog({
    actorUserId: captainUserId,
    actorRole: 'captain',
    targetType: 'captain_message',
    targetId: msg.message_id,
    action: scheduled ? 'CAPTAIN_MESSAGE_SCHEDULED' : 'CAPTAIN_MESSAGE_SENT',
    description: scheduled
      ? `Captain scheduled announcement "${subject}" for ${targetAudience}, to publish ${msg.publish_at.toISOString()}.`
      : `Captain sent message "${subject}" to audience: ${targetAudience}.`,
    metadata: { target_audience: targetAudience, subject, body, publish_at: msg.publish_at, expires_at: msg.expires_at }
  });

  return { ...msg, scheduled: !!scheduled };
}

/**
 * Notify everyone about scheduled announcements whose publish time has come.
 * The UPDATE … RETURNING claims each message once, even with several server instances.
 */
async function publishDueMessages() {
  try {
    const { rows } = await pool.query(
      `UPDATE captain_messages SET notified_at = NOW()
       WHERE notified_at IS NULL AND publish_at <= NOW()
         AND (expires_at IS NULL OR expires_at > NOW())
       RETURNING message_id, target_audience, subject, body, created_at, publish_at, expires_at`
    );
    rows.forEach(announceMessage);
    if (rows.length) console.log(`[Announcements] Published ${rows.length} scheduled announcement(s).`);
  } catch (err) {
    console.error('[Announcements] Scheduler error:', err.message);
  }
}

let schedulerTimer = null;
function startAnnouncementScheduler(intervalMs = 30000) {
  if (schedulerTimer) return;
  publishDueMessages();
  schedulerTimer = setInterval(publishDueMessages, intervalMs);
  schedulerTimer.unref?.();
}

async function getCaptainMessages({ limit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT cm.message_id, cm.target_audience, cm.subject, cm.body, cm.created_at,
            COALESCE(cm.publish_at, cm.created_at) AS publish_at, cm.expires_at,
            CASE WHEN COALESCE(cm.publish_at, cm.created_at) > NOW() THEN 'scheduled'
                 WHEN cm.expires_at IS NOT NULL AND cm.expires_at <= NOW() THEN 'expired'
                 ELSE 'live' END AS state,
            u.full_name AS captain_name
     FROM captain_messages cm
     LEFT JOIN users u ON u.user_id = cm.captain_user_id
     ORDER BY COALESCE(cm.publish_at, cm.created_at) DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

/** Announcements currently visible to a role: published and not yet expired. */
async function getInboxMessages(role, limit = 100) {
  const audience = role === 'resident' ? ['resident', 'all'] : ['staff', 'all'];
  const { rows } = await pool.query(
    `SELECT cm.message_id, cm.target_audience, cm.subject, cm.body,
            COALESCE(cm.publish_at, cm.created_at) AS created_at, cm.expires_at,
            u.full_name AS captain_name
     FROM captain_messages cm
     LEFT JOIN users u ON u.user_id = cm.captain_user_id
     WHERE cm.target_audience = ANY($1)
       AND COALESCE(cm.publish_at, cm.created_at) <= NOW()
       AND (cm.expires_at IS NULL OR cm.expires_at > NOW())
     ORDER BY COALESCE(cm.publish_at, cm.created_at) DESC
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
  getInboxMessages,
  startAnnouncementScheduler
};