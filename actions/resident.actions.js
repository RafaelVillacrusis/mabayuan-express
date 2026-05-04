const pool = require('../db');

async function getPendingResidents() {
  const result = await pool.query(
  `SELECT resident_id, first_name, middle_name, last_name, email, status, created_at, valid_id_path,
          phone_number, address
   FROM residents
   WHERE status = 'Pending'
   ORDER BY created_at DESC`
);
const rows = result.rows;
  return rows;
}

/* ── 2.4 Resident Record Management ────────────────────────────────── */

/**
 * Return all residents with optional status filter and keyword search.
 * @param {object} opts
 * @param {string} [opts.status]   'all' | 'Pending' | 'Approved' | 'Declined'
 * @param {string} [opts.search]   free-text search across name / email / address
 */
async function getAllResidents({ status = 'all', search = '' } = {}) {
  const conditions = [];
  const params = [];

  if (status && status !== 'all') {
    params.push(status);
    conditions.push(`r.status = $${params.length}`);
  }

  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    params.push(term);
    const idx = params.length;
    conditions.push(
      `(r.first_name ILIKE $${idx} OR r.middle_name ILIKE $${idx} OR r.last_name ILIKE $${idx}
        OR r.email ILIKE $${idx} OR r.phone_number ILIKE $${idx} OR r.address ILIKE $${idx})`
    );
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT r.resident_id, r.first_name, r.middle_name, r.last_name, r.suffix,
            r.email, r.phone_number, r.address, r.birth_date,
            r.status, r.valid_id_path, r.created_at,
            COUNT(req.request_id)::int AS total_requests
     FROM residents r
     LEFT JOIN requests req ON req.resident_id = r.resident_id
     ${where}
     GROUP BY r.resident_id
     ORDER BY r.created_at DESC`,
    params
  );
  return result.rows;
}

/**
 * Fetch a single resident by ID.
 */
async function getResidentById(residentId) {
  const { rows } = await pool.query(
    `SELECT r.resident_id, r.first_name, r.middle_name, r.last_name, r.suffix,
            r.email, r.phone_number, r.address, r.birth_date,
            r.status, r.valid_id_path, r.created_at,
            COUNT(req.request_id)::int AS total_requests
     FROM residents r
     LEFT JOIN requests req ON req.resident_id = r.resident_id
     WHERE r.resident_id = $1
     GROUP BY r.resident_id
     LIMIT 1`,
    [residentId]
  );
  return rows[0] || null;
}

/**
 * Update resident fields that staff are allowed to modify.
 */
async function updateResidentRecord(residentId, { first_name, middle_name, last_name, suffix, phone_number, address, birth_date }) {
  await pool.query(
    `UPDATE residents
     SET first_name   = COALESCE($1, first_name),
         middle_name  = $2,
         last_name    = COALESCE($3, last_name),
         suffix       = $4,
         phone_number = $5,
         address      = $6,
         birth_date   = $7
     WHERE resident_id = $8`,
    [first_name, middle_name || null, last_name, suffix || null, phone_number || null, address || null, birth_date || null, residentId]
  );
}

/**
 * Summary counts for the resident record management page.
 */
async function getResidentRecordCounts() {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)                                        AS total,
       COUNT(*) FILTER (WHERE status = 'Pending')     AS pending,
       COUNT(*) FILTER (WHERE status = 'Approved')    AS approved,
       COUNT(*) FILTER (WHERE status = 'Declined')    AS declined
     FROM residents`
  );
  return rows[0];
}

module.exports = {
  getPendingResidents,
  getAllResidents,
  getResidentById,
  updateResidentRecord,
  getResidentRecordCounts,
};
