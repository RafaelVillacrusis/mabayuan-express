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
const bcrypt = require('bcryptjs');
const profile = require('../actions/profile.actions');
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
    `SELECT resident_id, first_name, middle_name, last_name, suffix, email, phone_number,
            address, birth_date, gender, created_at
     FROM residents
     WHERE resident_id = $1
     LIMIT 1`,
    [req.session.resident.resident_id]
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'Profile not found.' });
  const pending = await profile.pendingChanges(row.resident_id).catch(() => []);
  res.json({
    ...row,
    pending: pending.map(p => ({ purpose: p.purpose, new_email: p.new_email ? profile.maskEmail(p.new_email) : null, expires_at: p.expires_at })),
  });
});

/* ================= PROFILE: edit ================= */
router.get('/resident/profile', requireResident, (req, res) =>
  res.sendFile(path.join(__dirname, '../dashboards/resident_profile.html'))
);

const STRONG_PASSWORD = p => p.length >= 8 && /[a-zA-Z]/.test(p) && /[0-9]/.test(p) && /[^a-zA-Z0-9]/.test(p);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function loadResident(req) {
  const { rows } = await pool.query(
    `SELECT resident_id, first_name, last_name, email, phone_number, password_hash FROM residents WHERE resident_id = $1`,
    [req.session.resident.resident_id]);
  return rows[0];
}
function profileError(res, err) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error('Profile error:', err);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
}
async function profileAudit(residentId, action, description, metadata = {}) {
  await createAuditLog({ actorRole: 'resident', targetType: 'resident', targetId: residentId, action, description, metadata }).catch(() => {});
}

// Contact number — no verification needed
router.post('/api/resident/profile/contact', requireResident, async (req, res) => {
  try {
    let phone = String(req.body.phone_number || '').replace(/\D/g, '');
    if (phone.startsWith('63')) phone = phone.slice(2);
    if (phone.startsWith('0')) phone = phone.slice(1);
    if (!/^9\d{9}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid mobile number: 10 digits starting with 9 (e.g. 9171234567).', field: 'phone_number' });
    const me = await loadResident(req);
    const stored = '0' + phone;
    if (me.phone_number === stored) return res.json({ ok: true, phone_number: stored, unchanged: true });
    await pool.query('UPDATE residents SET phone_number = $1 WHERE resident_id = $2', [stored, me.resident_id]);
    await profileAudit(me.resident_id, 'RESIDENT_CONTACT_UPDATED', `${me.first_name} ${me.last_name} updated their contact number.`);
    res.json({ ok: true, phone_number: stored });
  } catch (err) { profileError(res, err); }
});

// Email — step 1: confirm current password, send a code to the NEW address
router.post('/api/resident/profile/email/start', requireResident, async (req, res) => {
  try {
    const newEmail = String(req.body.new_email || '').trim().toLowerCase();
    const me = await loadResident(req);
    if (!EMAIL_RE.test(newEmail)) return res.status(400).json({ error: 'Please enter a valid email address.', field: 'new_email' });
    if (newEmail === String(me.email).toLowerCase()) return res.status(400).json({ error: 'That is already your email address.', field: 'new_email' });
    if (!(await bcrypt.compare(String(req.body.current_password || ''), me.password_hash))) {
      return res.status(400).json({ error: 'Your current password is incorrect.', field: 'current_password' });
    }
    const { rows: taken } = await pool.query(
      `SELECT 1 FROM residents WHERE LOWER(email) = $1 AND resident_id <> $2
       UNION ALL SELECT 1 FROM users WHERE LOWER(email) = $1 LIMIT 1`, [newEmail, me.resident_id]);
    if (taken.length) return res.status(400).json({ error: 'This email is already used by another account.', field: 'new_email' });
    const out = await profile.startChange({ resident: me, purpose: 'email', sendTo: newEmail, newEmail });
    res.json({ ok: true, ...out });
  } catch (err) { profileError(res, err); }
});

// Email — step 2: enter the code
router.post('/api/resident/profile/email/confirm', requireResident, async (req, res) => {
  try {
    const me = await loadResident(req);
    const v = await profile.confirmChange({ residentId: me.resident_id, purpose: 'email', code: req.body.code });
    const { rows: taken } = await pool.query(
      `SELECT 1 FROM residents WHERE LOWER(email) = $1 AND resident_id <> $2
       UNION ALL SELECT 1 FROM users WHERE LOWER(email) = $1 LIMIT 1`, [v.new_email, me.resident_id]);
    if (taken.length) return res.status(400).json({ error: 'This email was just taken by another account. Please use a different one.' });
    await pool.query('UPDATE residents SET email = $1 WHERE resident_id = $2', [v.new_email, me.resident_id]);
    req.session.resident.email = v.new_email;
    await profileAudit(me.resident_id, 'RESIDENT_EMAIL_CHANGED', `${me.first_name} ${me.last_name} changed their email (verified).`, { old_email: me.email, new_email: v.new_email });
    profile.sendNotice({ to: me.email, firstName: me.first_name, title: 'Your email was changed',
      body: `The email for your Mabayuan Express account was changed to <strong>${profile.maskEmail(v.new_email)}</strong>. From now on, log in and receive updates with the new address.` });
    res.json({ ok: true, email: v.new_email });
  } catch (err) { profileError(res, err); }
});

// Password — step 1: check current + new password, send a code to the CURRENT email
router.post('/api/resident/profile/password/start', requireResident, async (req, res) => {
  try {
    const { current_password, new_password, confirm_password } = req.body;
    const me = await loadResident(req);
    if (!(await bcrypt.compare(String(current_password || ''), me.password_hash))) {
      return res.status(400).json({ error: 'Your current password is incorrect.', field: 'current_password' });
    }
    const pw = String(new_password || '');
    if (!STRONG_PASSWORD(pw)) return res.status(400).json({ error: 'Your new password must be at least 8 characters and include a letter, a number and a special character.', field: 'new_password' });
    if (pw !== String(confirm_password || '')) return res.status(400).json({ error: 'The new passwords do not match.', field: 'confirm_password' });
    if (await bcrypt.compare(pw, me.password_hash)) return res.status(400).json({ error: 'Your new password must be different from your current one.', field: 'new_password' });
    const newHash = await bcrypt.hash(pw, 10);
    const out = await profile.startChange({ resident: me, purpose: 'password', sendTo: me.email, newPasswordHash: newHash });
    res.json({ ok: true, ...out });
  } catch (err) { profileError(res, err); }
});

// Password — step 2: enter the code
router.post('/api/resident/profile/password/confirm', requireResident, async (req, res) => {
  try {
    const me = await loadResident(req);
    const v = await profile.confirmChange({ residentId: me.resident_id, purpose: 'password', code: req.body.code });
    await pool.query('UPDATE residents SET password_hash = $1 WHERE resident_id = $2', [v.new_password_hash, me.resident_id]);
    await profileAudit(me.resident_id, 'RESIDENT_PASSWORD_CHANGED', `${me.first_name} ${me.last_name} changed their password (verified).`);
    profile.sendNotice({ to: me.email, firstName: me.first_name, title: 'Your password was changed',
      body: 'The password for your Mabayuan Express account was just changed. Use your new password the next time you log in.' });
    res.json({ ok: true });
  } catch (err) { profileError(res, err); }
});

// Cancel a pending email/password change
router.post('/api/resident/profile/:purpose(email|password)/cancel', requireResident, async (req, res) => {
  try {
    await profile.cancelChange(req.session.resident.resident_id, req.params.purpose);
    res.json({ ok: true });
  } catch (err) { profileError(res, err); }
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