const pool = require('../db');
const { createAuditLog } = require('./audit.actions');
const { refreshRoleDashboards } = require('./notification.actions');

const ROLE_LABEL = { captain: 'Captain', system_admin: 'System admin' };

/** Every document type with how many requests use it (in total and still open). */
async function listDocumentsWithUsage() {
  const { rows } = await pool.query(`
    SELECT d.*,
           COUNT(r.request_id)::int AS request_count,
           COUNT(r.request_id) FILTER (WHERE r.status IN ('Pending Approval','Approved','Ready for Pickup'))::int AS open_count
    FROM documents d
    LEFT JOIN requests r ON r.document_id = d.document_id
    GROUP BY d.document_id
    ORDER BY d.is_active DESC, d.document_name ASC`);
  return rows;
}

/** Validate and normalise form input. Returns { data } or { error, field }. */
async function validateDocument(body, excludeId = null) {
  const name = String(body.document_name || '').trim().replace(/\s+/g, ' ');
  const description = String(body.description || '').trim();
  const price = Number(body.price);
  const days = Number(body.processing_days);
  const isActive = body.is_active === undefined ? true : ['1', 'true', true, 1, 'on'].includes(body.is_active);

  if (name.length < 3) return { error: 'Please enter the document name (at least 3 characters).', field: 'document_name' };
  if (name.length > 120) return { error: 'The document name must be 120 characters or fewer.', field: 'document_name' };
  if (description.length > 300) return { error: 'The description must be 300 characters or fewer.', field: 'description' };
  if (body.price === '' || body.price === undefined || !Number.isFinite(price) || price < 0 || price > 100000)
    return { error: 'Please enter a fee from ₱0 to ₱100,000 (use 0 for free documents).', field: 'price' };
  if (!Number.isInteger(days) || days < 0 || days > 60)
    return { error: 'Processing days must be a whole number from 0 (same day) to 60.', field: 'processing_days' };

  const { rows } = await pool.query(
    `SELECT document_id, document_name FROM documents WHERE LOWER(document_name) = LOWER($1) AND ($2::int IS NULL OR document_id <> $2) LIMIT 1`,
    [name, excludeId]);
  if (rows.length) return { error: `A document named "${rows[0].document_name}" already exists.`, field: 'document_name' };

  return { data: { name, description: description || null, price: Math.round(price * 100) / 100, days, isActive } };
}

async function audit(actor, documentId, action, description, metadata) {
  await createAuditLog({
    actorUserId: actor.user_id,
    actorRole: actor.role,
    targetType: 'document',
    targetId: documentId,
    action,
    description,
    metadata,
  });
  refreshRoleDashboards('system_admin', 'resident', 'staff', 'captain');
}

async function createDocument(actor, d) {
  const { rows: [doc] } = await pool.query(
    `INSERT INTO documents (document_name, description, price, processing_days, is_active)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [d.name, d.description, d.price, d.days, d.isActive]);
  await audit(actor, doc.document_id, 'DOCUMENT_CREATED',
    `${ROLE_LABEL[actor.role] || actor.role} added document type "${d.name}".`,
    { price: d.price, processing_days: d.days, is_active: d.isActive });
  return doc;
}

async function updateDocument(actor, id, d) {
  const { rows: [before] } = await pool.query('SELECT * FROM documents WHERE document_id = $1', [id]);
  if (!before) return null;
  const { rows: [doc] } = await pool.query(
    `UPDATE documents SET document_name=$1, description=$2, price=$3, processing_days=$4, is_active=$5
     WHERE document_id=$6 RETURNING *`,
    [d.name, d.description, d.price, d.days, d.isActive, id]);
  const changes = [];
  if (before.document_name !== d.name) changes.push(`name "${before.document_name}" → "${d.name}"`);
  if (Number(before.price) !== d.price) changes.push(`fee ₱${Number(before.price).toFixed(2)} → ₱${d.price.toFixed(2)}`);
  if (Number(before.processing_days) !== d.days) changes.push(`processing ${before.processing_days} → ${d.days} day(s)`);
  if (Boolean(before.is_active) !== d.isActive) changes.push(d.isActive ? 'made available' : 'made unavailable');
  if ((before.description || null) !== d.description) changes.push('description updated');
  await audit(actor, id, 'DOCUMENT_UPDATED',
    `${ROLE_LABEL[actor.role] || actor.role} updated document type "${d.name}"${changes.length ? ': ' + changes.join(', ') : ''}.`,
    { price: d.price, processing_days: d.days, is_active: d.isActive, changes });
  return doc;
}

/** Deletes only documents that were never requested — others should be made unavailable instead. */
async function deleteDocument(actor, id) {
  const { rows: [doc] } = await pool.query(
    `SELECT d.document_name, COUNT(r.request_id)::int AS request_count
     FROM documents d LEFT JOIN requests r ON r.document_id = d.document_id
     WHERE d.document_id = $1 GROUP BY d.document_id`, [id]);
  if (!doc) return { status: 404, error: 'Document not found.' };
  if (doc.request_count > 0) {
    return { status: 409, error: `"${doc.document_name}" has ${doc.request_count} request${doc.request_count === 1 ? '' : 's'} on record, so it can't be deleted. Make it Unavailable instead — residents will no longer be able to request it.` };
  }
  await pool.query('DELETE FROM documents WHERE document_id = $1', [id]);
  await audit(actor, id, 'DOCUMENT_DELETED',
    `${ROLE_LABEL[actor.role] || actor.role} deleted document type "${doc.document_name}".`,
    { document_name: doc.document_name });
  return { ok: true };
}

module.exports = { listDocumentsWithUsage, validateDocument, createDocument, updateDocument, deleteDocument };
