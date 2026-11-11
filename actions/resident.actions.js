const pool = require('../db');

async function getPendingResidents() {
  const result = await pool.query(
  `SELECT resident_id, first_name, middle_name, last_name, email, status, created_at, valid_id_path, valid_id_type, residency_cert_path,
          phone_number, address, suffix, birth_date
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
async function getAllResidents({ status = 'all', search = '', archived = false } = {}) {
  const conditions = [];
  const params = [];

  // By default exclude archived residents; show only archived when explicitly requested
  if (archived) {
    conditions.push(`r.is_archived = TRUE`);
  } else {
    conditions.push(`r.is_archived = FALSE`);
    if (status && status !== 'all') {
      params.push(status);
      conditions.push(`r.status = $${params.length}`);
    }
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
            r.status, r.is_archived, r.valid_id_path, r.valid_id_type, r.residency_cert_path, r.created_at,
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
            r.status, r.valid_id_path, r.valid_id_type, r.residency_cert_path, r.created_at,
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
async function updateResidentRecord(residentId, { first_name, middle_name, last_name, suffix, email, phone_number, address, birth_date }) {
  await pool.query(
    `UPDATE residents
     SET first_name   = COALESCE($1, first_name),
         middle_name  = $2,
         last_name    = COALESCE($3, last_name),
         suffix       = $4,
         email        = COALESCE($5, email),
         phone_number = $6,
         address      = $7,
         birth_date   = $8
     WHERE resident_id = $9`,
    [first_name, middle_name || null, last_name, suffix || null, email || null, phone_number || null, address || null, birth_date || null, residentId]
  );
}

/**
 * Summary counts for the resident record management page.
 */
async function getResidentRecordCounts() {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE is_archived = FALSE)                          AS total,
       COUNT(*) FILTER (WHERE status = 'Pending'  AND is_archived = FALSE)  AS pending,
       COUNT(*) FILTER (WHERE status = 'Approved' AND is_archived = FALSE)  AS approved,
       COUNT(*) FILTER (WHERE status = 'Declined' AND is_archived = FALSE)  AS declined,
       COUNT(*) FILTER (WHERE is_archived = TRUE)                           AS archived
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
