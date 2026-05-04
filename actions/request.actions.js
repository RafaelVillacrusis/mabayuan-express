const pool = require('../db');

/* =======================
   HELPERS
======================= */

function generateTransactionNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TXN-${y}${m}${d}-${rand}`;
}

function addDays(dateInput, days) {
  const date = new Date(dateInput);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + Number(days || 0));
  return date;
}

function toDateInput(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/* =======================
   LOGS
======================= */

async function createRequestLog(data) {
  await pool.query(
    `
    INSERT INTO request_logs
      (request_id, action_type, old_status, new_status,
       old_release_date, new_release_date,
       remarks, changed_by_user_id, changed_by_role)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `,
    [
      data.requestId,
      data.actionType,
      data.oldStatus,
      data.newStatus,
      data.oldReleaseDate || null,
      data.newReleaseDate || null,
      data.remarks || null,
      data.changedByUserId || null,
      data.changedByRole || null
    ]
  );
}

/* =======================
   DOCUMENTS
======================= */

async function getAvailableDocuments() {
  const { rows } = await pool.query(
    `
    SELECT document_id, document_name, description, price, processing_days
    FROM documents
    WHERE is_active = true
    ORDER BY document_name ASC
    `
  );
  return rows;
}

/* =======================
   RESIDENT
======================= */

async function getResidentStats(residentId) {
  const { rows } = await pool.query(
    `
    SELECT
      COUNT(*) AS total_requests,
      SUM(CASE WHEN status IN ('Pending Approval','Approved') THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END) AS processing_count,
      SUM(CASE WHEN status = 'Ready for Pickup' THEN 1 ELSE 0 END) AS ready_count,
      SUM(CASE WHEN status = 'Declined' THEN 1 ELSE 0 END) AS declined_count
    FROM requests
    WHERE resident_id = $1
    `,
    [residentId]
  );
  return rows[0];
}

async function getResidentRequests(residentId, filter = 'all') {
  let sql = `
    SELECT *
    FROM requests
    WHERE resident_id = $1
  `;
  const params = [residentId];

  if (filter === 'pending') {
    sql += ` AND status IN ('Pending Approval','Approved')`;
  } else if (filter === 'ready') {
    sql += ` AND status = 'Ready for Pickup'`;
  } else if (filter !== 'all') {
    sql += ` AND status = $2`;
    params.push(filter);
  }

  sql += ` ORDER BY created_at DESC`;

  const { rows } = await pool.query(sql, params);
  return rows;
}

/* =======================
   STAFF / CAPTAIN
======================= */

async function getRequestsByRole(role, filter = 'all') {
  if (!role) return [];

  let baseWhere = '1=1';
  if (role === 'captain') {
    baseWhere = `r.status IN ('Pending Approval','Approved','Declined','Ready for Pickup','Claimed')`;
  } else if (role === 'staff') {
    baseWhere = `r.status IN ('Approved','Ready for Pickup','Claimed')`;
  }

  let sql = `
    SELECT
      r.*,
      res.last_name || ', ' || res.first_name AS resident_name
    FROM requests r
    JOIN residents res ON res.resident_id = r.resident_id
    WHERE ${baseWhere}
  `;
  const params = [];

  if (filter !== 'all') {
    sql += ` AND r.status = $1`;
    params.push(filter);
  }

  sql += ` ORDER BY r.created_at DESC`;

  const { rows } = await pool.query(sql, params);
  return rows;
}

async function getRequestById(requestId) {
  const { rows } = await pool.query(
    `
    SELECT
      r.request_id,
      r.resident_id,
      r.transaction_no,
      r.document_name,
      r.document_id,
      r.price_at_request,
      r.processing_days_at_request,
      r.purpose,
      r.status,
      r.suggested_release_date,
      r.release_date,
      r.captain_notes,
      r.staff_notes,
      r.processed_by,
      r.claimed_at,
      r.created_at,
      r.updated_at,
      res.last_name || ', ' || res.first_name AS resident_name,
      res.first_name,
      res.last_name,
      res.email,
      r.contact_number,
      res.phone_number,
      res.address
    FROM requests r
    JOIN residents res ON res.resident_id = r.resident_id
    WHERE r.request_id = $1
    LIMIT 1
    `,
    [requestId]
  );
  return rows[0];
}

async function getRequestLogs(requestId) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM request_logs
    WHERE request_id = $1
    ORDER BY created_at DESC, log_id DESC
    `,
    [requestId]
  );
  return rows;
}

async function getRoleCounts(role) {
  let where = '1=1';
  if (role === 'captain') where = `status IN ('Pending Approval','Approved','Declined','Ready for Pickup','Claimed')`;
  if (role === 'staff') where = `status IN ('Approved','Ready for Pickup','Claimed')`;

  const { rows } = await pool.query(
    `
    SELECT
      COUNT(*) AS total_requests,
      SUM(CASE WHEN status = 'Pending Approval' THEN 1 ELSE 0 END) AS pending_approval,
      SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END) AS approved_count,
      SUM(CASE WHEN status = 'Ready for Pickup' THEN 1 ELSE 0 END) AS ready_count,
      SUM(CASE WHEN status = 'Claimed' THEN 1 ELSE 0 END) AS claimed_count,
      SUM(CASE WHEN status = 'Declined' THEN 1 ELSE 0 END) AS declined_count
    FROM requests
    WHERE ${where}
    `
  );
  return rows[0];
}

module.exports = {
  generateTransactionNumber,
  addDays,
  toDateInput,
  createRequestLog,
  getAvailableDocuments,
  getResidentStats,
  getResidentRequests,
  getRequestsByRole,
  getRequestById,
  getRequestLogs,
  getRoleCounts
};