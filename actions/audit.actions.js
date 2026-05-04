const pool = require('../db');

async function createAuditLog({
  actorUserId = null,
  actorRole = null,
  targetType,
  targetId = null,
  action,
  description,
  metadata = null
}) {
  await pool.query(
    `INSERT INTO audit_logs
      (actor_user_id, actor_role, target_type, target_id, action, description, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [actorUserId, actorRole, targetType, targetId, action, description, metadata ? JSON.stringify(metadata) : null]
  );
}

async function getRecentAuditLogs(limit = 50) {
  const safeLimit = Number(limit) > 0 ? Number(limit) : 50;
  const { rows } = await pool.query(
    `SELECT a.audit_id, a.actor_user_id, a.actor_role, a.target_type, a.target_id, a.action, a.description,
            a.metadata, a.created_at, u.full_name AS actor_name
     FROM audit_logs a
     LEFT JOIN users u ON u.user_id = a.actor_user_id
     ORDER BY a.created_at DESC, a.audit_id DESC
     LIMIT ${safeLimit}`
  );
  return rows.map((row) => ({
    ...row,
    metadata: row.metadata ? safeParse(row.metadata) : null
  }));
}

async function getFilteredAuditLogs({
  actor = '',
  action = '',
  targetType = '',
  dateFrom = '',
  dateTo = '',
  limit = 100
} = {}) {
  const conditions = [];
  const params = [];

  if (actor) {
    const actorLike = `%${actor}%`;
    params.push(actorLike, actorLike);
    conditions.push(`(
      u.full_name LIKE $${params.length - 1}
      OR a.actor_role LIKE $${params.length}
    )`);
  }

  if (action) {
    params.push(`%${action}%`);
    conditions.push(`a.action LIKE $${params.length}`);
  }

  if (targetType) {
    params.push(targetType);
    conditions.push(`a.target_type = $${params.length}`);
  }

  if (dateFrom) {
    params.push(dateFrom);
    conditions.push(`DATE(a.created_at) >= $${params.length}`);
  }

  if (dateTo) {
    params.push(dateTo);
    conditions.push(`DATE(a.created_at) <= $${params.length}`);
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT a.audit_id, a.actor_user_id, a.actor_role, a.target_type, a.target_id, a.action, a.description,
            a.metadata, a.created_at, u.full_name AS actor_name
     FROM audit_logs a
     LEFT JOIN users u ON u.user_id = a.actor_user_id
     ${whereClause}
     ORDER BY a.created_at DESC, a.audit_id DESC
     LIMIT ${safeLimit}`,
    params
  );

  return rows.map((row) => ({
    ...row,
    metadata: row.metadata ? safeParse(row.metadata) : null
  }));
}

function safeParse(value) {
  try { return JSON.parse(value); } catch { return value; }
}

module.exports = {
  createAuditLog,
  getRecentAuditLogs,
  getFilteredAuditLogs
};
