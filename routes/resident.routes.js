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
  getInboxMessages,
  getPublicAnnouncements,
  getAnnouncementForImage
} = require('../actions/notification.actions');
const { createAuditLog } = require('../actions/audit.actions');
const { VALID_ID_TYPES, ALLOWED_UPLOAD_MIME, uploadToStorage, removeFromStorage, sendStoredFile, FILE_NOT_FOUND_PAGE } = require('../actions/upload.actions');

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

// Public barangay announcements for the landing page — live announcements the Captain sent to Everyone
router.get('/api/public/announcements', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 50);
    const rows = await getPublicAnnouncements(limit);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(rows.map(m => ({
      id: m.message_id,
      subject: m.subject,
      body: m.body,
      created_at: m.created_at,
      expires_at: m.expires_at,
      image_url: m.has_image ? `/api/announcements/${m.message_id}/image` : null,
      posted_by: m.captain_name || 'Barangay Captain',
    })));
  } catch (err) {
    console.error('Public announcements error:', err);
    res.status(500).json({ error: 'Could not load announcements.' });
  }
});

// Announcement image. Live "Everyone" announcements are public; others need a matching login.
router.get('/api/announcements/:id/image', async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(404).send('Image not found.');
    const msg = await getAnnouncementForImage(req.params.id);
    if (!msg || !msg.image_path) return res.status(404).send('Image not found.');
    const role = req.session.resident ? 'resident' : (req.session.user && req.session.user.role);
    const isPublic = msg.target_audience === 'all' && msg.is_live;
    const allowed = isPublic
      || role === 'captain' || role === 'system_admin'
      || (msg.is_live && (msg.target_audience === 'all' || msg.target_audience === role));
    if (!allowed) return res.status(404).send('Image not found.');
    res.set('Cache-Control', isPublic ? 'public, max-age=3600' : 'private, max-age=3600');
    if (!(await sendStoredFile(res, msg.image_path, { cache: true }))) res.status(404).send('Image not found.');
  } catch (err) {
    console.error('Announcement image error:', err);
    if (!res.headersSent) res.status(500).send('Could not load the image.');
  }
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
// Multipart form with the resident's valid ID. Responds with JSON so the form keeps its values on error.
const requestUpload = upload.single('valid_id');
router.post('/api/resident/requests', requireResident, (req, res, next) => {
  requestUpload(req, res, err => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Your valid ID file must be 5MB or smaller.' : 'The valid ID upload failed. Please try again.';
      return res.status(400).json({ error: msg, field: 'valid_id' });
    }
    next();
  });
}, async (req, res) => {
  let storedIdPath = null;
  try {
    const residentId = req.session.resident.resident_id;
    const { document_id, contact_number, purpose, purpose_details, valid_id_type } = req.body;
    const fail = (error, field) => res.status(400).json({ error, field });

    // Validate contact number — must be 11 digits starting with 09
    if (contact_number) {
      const cleaned = contact_number.startsWith('0') ? contact_number : '0' + contact_number;
      if (!/^09[0-9]{9}$/.test(cleaned)) return fail('Please enter a valid mobile number (10 digits starting with 9).', 'contact_number');
    }
    if (!purpose) return fail('Please choose the purpose of your request.', 'purpose');

    // Valid ID — required for every request
    if (!VALID_ID_TYPES.includes(valid_id_type)) return fail('Please select the type of valid ID you are uploading.', 'valid_id_type');
    if (!req.file) return fail('Please upload a photo of your valid ID.', 'valid_id');
    if (!ALLOWED_UPLOAD_MIME.test(req.file.mimetype)) return fail('Your valid ID must be an image (JPG, PNG, GIF, WEBP) or a PDF.', 'valid_id');

    // Document
    const docResult = await pool.query(
      `SELECT document_id, document_name, price, processing_days
       FROM documents
       WHERE document_id = $1 AND is_active = true
       LIMIT 1`,
      [document_id]
    );
    const documentRow = docResult.rows[0];
    if (!documentRow) return fail('The selected document is not available. Please choose another one.', 'document_id');

    // Resident
    const residentResult = await pool.query(
      `SELECT phone_number FROM residents WHERE resident_id = $1 LIMIT 1`,
      [residentId]
    );
    const resident = residentResult.rows[0] || {};

    storedIdPath = await uploadToStorage(req.file, 'requests', `resident-${residentId}`);
    if (!storedIdPath) return res.status(500).json({ error: 'We could not save your valid ID. Please try again.', field: 'valid_id' });

    const transactionNo = generateTransactionNumber();
    const combinedPurpose = [purpose, purpose_details].filter(Boolean).join(' - ');
    const suggestedReleaseDate = toDateInput(
      addDays(new Date(), documentRow.processing_days)
    );

    const insertResult = await pool.query(
      `INSERT INTO requests
        (resident_id, document_id, document_name, price_at_request,
         processing_days_at_request, suggested_release_date, status,
         transaction_no, purpose, contact_number, valid_id_path, valid_id_type)
       VALUES
        ($1,$2,$3,$4,$5,$6,'Pending Approval',$7,$8,$9,$10,$11)
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
        storedIdPath,
        valid_id_type
      ]
    );

    const requestId = insertResult.rows[0].request_id;
    storedIdPath = null; // saved with the request — keep the file

    await createRequestLog({
      requestId,
      actionType: 'CREATE',
      newStatus: 'Pending Approval',
      newReleaseDate: suggestedReleaseDate,
      remarks: `Resident submitted a new request with a ${valid_id_type}.`,
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
      metadata: { resident_id: residentId, suggested_release_date: suggestedReleaseDate, valid_id_type }
    });

    refreshRoleDashboards('captain', 'system_admin', 'staff');
    res.json({ ok: true, redirect: '/resident/dashboard?submitted=1', transaction_no: transactionNo });

  } catch (error) {
    console.error(error);
    if (storedIdPath) removeFromStorage(storedIdPath); // request wasn't saved — don't leave the file behind
    res.status(500).json({ error: 'Could not submit your request. Please try again.' });
  }
});

/* ================= RESIDENT: VIEW OWN REQUEST ID ================= */
router.get('/api/resident/requests/:id/valid-id', requireResident, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT valid_id_path FROM requests WHERE request_id = $1 AND resident_id = $2 LIMIT 1`,
      [req.params.id, req.session.resident.resident_id]
    );
    if (!rows.length || !(await sendStoredFile(res, rows[0].valid_id_path))) res.status(404).send(FILE_NOT_FOUND_PAGE);
  } catch (err) {
    console.error('Request valid ID error:', err);
    if (!res.headersSent) res.status(500).send('Could not load the valid ID.');
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
    // IDs uploaded with the request (not the registration ID) are removed with it
    if (String(request.valid_id_path || '').startsWith('supabase:valid-ids/requests/')) removeFromStorage(request.valid_id_path);
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