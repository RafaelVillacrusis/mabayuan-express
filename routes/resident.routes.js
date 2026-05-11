const express = require('express');
const path = require('path');
const pool = require('../db');
const multer = require('multer');
const supabase = require('../supabase');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const { requireResident } = require('../middleware/auth');
const {
  getAvailableDocuments,
  getResidentStats,
  getResidentRequests,
  generateTransactionNumber,
  addDays,
  toDateInput,
  createRequestLog
} = require('../actions/request.actions');
const {
  createResidentNotification,
  getResidentNotifications,
  markNotificationsRead,
  refreshRoleDashboards,
  getInboxMessages
} = require('../actions/notification.actions');
const { createAuditLog } = require('../actions/audit.actions');

const router = express.Router();

router.get('/resident/dashboard', requireResident, (req, res) =>
  res.sendFile(path.join(__dirname, '../dashboards/resident_dashboard.html'))
);

router.get('/resident/inbox', requireResident, (req, res) =>
  res.sendFile(path.join(__dirname, '../dashboards/resident_inbox.html'))
);

router.get('/api/resident/inbox', requireResident, async (req, res) => {
  const rows = await getInboxMessages('resident');
  res.json(rows);
});

router.get('/resident/request', requireResident, (req, res) =>
  res.sendFile(path.join(__dirname, '../views/request_document.html'))
);

router.get('/api/public/documents', async (req, res) => {
  const rows = await getAvailableDocuments();
  res.json(rows);
});

/* ================= PROFILE ================= */
router.get('/api/resident/profile', requireResident, async (req, res) => {
  const result = await pool.query(
    `SELECT resident_id, first_name, last_name, email, phone_number
     FROM residents
     WHERE resident_id = $1
     LIMIT 1`,
    [req.session.resident.resident_id]
  );
  res.json(result.rows[0]);
});

// Lightweight "me" endpoint — includes valid_id_path for re-upload check
router.get('/api/resident/me', requireResident, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT resident_id, first_name, last_name, email, valid_id_path FROM residents WHERE resident_id = $1 LIMIT 1`,
    [req.session.resident.resident_id]
  );
  res.json(rows[0] || {});
});

/* ================= STATS ================= */
router.get('/api/resident/stats', requireResident, async (req, res) => {
  const stats = await getResidentStats(req.session.resident.resident_id);
  res.json(stats);
});

/* ================= REQUEST LIST ================= */
router.get('/api/resident/requests', requireResident, async (req, res) => {
  const rows = await getResidentRequests(
    req.session.resident.resident_id,
    req.query.status || 'all'
  );
  res.json(rows);
});

/* ================= CREATE REQUEST ================= */
router.post('/api/resident/requests', requireResident, async (req, res) => {
  try {
    const residentId = req.session.resident.resident_id;
    const { document_id, contact_number, purpose, purpose_details } = req.body;

    // Validate contact number — must be 11 digits starting with 09
    if (contact_number) {
      const cleaned = contact_number.startsWith('0') ? contact_number : '0' + contact_number;
      if (!/^09[0-9]{9}$/.test(cleaned)) {
        return res.status(400).send('Invalid contact number format.');
      }
    }

    // Document
    const docResult = await pool.query(
      `SELECT document_id, document_name, price, processing_days
       FROM documents
       WHERE document_id = $1 AND is_active = true
       LIMIT 1`,
      [document_id]
    );

    const documentRow = docResult.rows[0];
    if (!documentRow) {
      return res.status(400).send('Selected document is not available.');
    }

    // Resident
    const residentResult = await pool.query(
      `SELECT valid_id_path, phone_number
       FROM residents
       WHERE resident_id = $1
       LIMIT 1`,
      [residentId]
    );
    const resident = residentResult.rows[0];

    const transactionNo = generateTransactionNumber();
    const combinedPurpose = [purpose, purpose_details].filter(Boolean).join(' - ');
    const suggestedReleaseDate = toDateInput(
      addDays(new Date(), documentRow.processing_days)
    );

    // INSERT REQUEST (IMPORTANT: RETURNING)
    const insertResult = await pool.query(
      `INSERT INTO requests
        (resident_id, document_id, document_name, price_at_request,
         processing_days_at_request, suggested_release_date, status,
         transaction_no, purpose, contact_number, valid_id_path)
       VALUES
        ($1,$2,$3,$4,$5,$6,'Pending Approval',$7,$8,$9,$10)
       RETURNING request_id`,
      [
        residentId,
        documentRow.document_id,
        documentRow.document_name,
        documentRow.price,
        documentRow.processing_days,
        suggestedReleaseDate,
        transactionNo,
        combinedPurpose || null,
        contact_number || resident.phone_number || null,
        resident.valid_id_path || null
      ]
    );

    const requestId = insertResult.rows[0].request_id;

    await createRequestLog({
      requestId,
      actionType: 'CREATE',
      newStatus: 'Pending Approval',
      newReleaseDate: suggestedReleaseDate,
      remarks: 'Resident submitted a new request.',
      changedByRole: 'resident'
    });

    await createResidentNotification({
      residentId,
      requestId,
      title: 'Request submitted',
      message: `${documentRow.document_name} request received. Transaction no: ${transactionNo}. Suggested release date: ${suggestedReleaseDate}.`,
      actorRole: 'resident',
      eventType: 'REQUEST_SUBMITTED_NOTIFICATION'
    });

    await createAuditLog({
      actorRole: 'resident',
      targetType: 'request',
      targetId: requestId,
      action: 'REQUEST_SUBMITTED',
      description: `Resident submitted ${documentRow.document_name} request with transaction ${transactionNo}.`,
      metadata: { resident_id: residentId, suggested_release_date: suggestedReleaseDate }
    });

    refreshRoleDashboards('captain', 'system_admin', 'staff');
    res.redirect('/resident/dashboard?submitted=1');

  } catch (error) {
    console.error(error);
    res.status(500).send('Could not submit request.');
  }
});

/* ================= NOTIFICATIONS ================= */

/* ================= GET SINGLE REQUEST (view details) ================= */
router.get('/api/resident/requests/:id', requireResident, async (req, res) => {
  try {
    const residentId = req.session.resident.resident_id;
    const { rows } = await pool.query(
      `SELECT r.*, res.first_name, res.last_name
       FROM requests r
       JOIN residents res ON r.resident_id = res.resident_id
       WHERE r.request_id = $1 AND r.resident_id = $2 LIMIT 1`,
      [req.params.id, residentId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Request not found.' });
    res.json(rows[0]);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

/* ================= DELETE REQUEST (pending only) ================= */
router.delete('/api/resident/requests/:id', requireResident, async (req, res) => {
  try {
    const residentId = req.session.resident.resident_id;
    const { rows } = await pool.query(
      `SELECT * FROM requests WHERE request_id = $1 AND resident_id = $2 LIMIT 1`,
      [req.params.id, residentId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Request not found.' });
    const request = rows[0];
    const deletable = ['Pending Approval', 'Pending', 'pending', 'pending approval'];
    if (!deletable.some(s => request.status.toLowerCase() === s.toLowerCase())) {
      return res.status(400).json({ error: 'Only pending requests can be deleted.' });
    }
    await pool.query('DELETE FROM requests WHERE request_id = $1 AND resident_id = $2', [req.params.id, residentId]);
    res.json({ ok: true, message: 'Request deleted successfully.' });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

router.get('/api/resident/notifications', requireResident, async (req, res) => {
  const rows = await getResidentNotifications(req.session.resident.resident_id);
  res.json(rows);
});

router.post('/api/resident/notifications/read', requireResident, async (req, res) => {
  await markNotificationsRead(req.session.resident.resident_id);
  res.json({ ok: true });
});

router.post('/api/resident/reupload-id', requireResident, upload.single('valid_id'), async (req, res) => {
  try {
    const residentId = req.session.resident.resident_id;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const ext = req.file.originalname.split('.').pop().replace(/[^a-zA-Z0-9]/g, '');
    const fileName = `reupload-${residentId}-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('valid-ids')
      .upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: false });

    if (uploadError) {
      console.error('Supabase Storage re-upload error:', uploadError);
      return res.status(500).json({ error: 'Failed to upload ID. Please try again.' });
    }

    await pool.query(
      `UPDATE residents SET valid_id_path = $1 WHERE resident_id = $2`,
      [`supabase:valid-ids/${fileName}`, residentId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Re-upload error:', err);
    res.status(500).json({ error: 'Server error during re-upload.' });
  }
});

module.exports = router;