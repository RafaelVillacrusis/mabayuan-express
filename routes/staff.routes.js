const express = require('express');
const path = require('path');
const fs = require('fs');
const pool = require('../db');
const supabase = require('../supabase');
const { requireRole } = require('../middleware/auth');
const { getRoleCounts, getRequestsByRole, getRequestById, getRequestLogs, createRequestLog, toDateInput } = require('../actions/request.actions');
const {
  getPendingResidents,
  getAllResidents,
  getResidentById,
  updateResidentRecord,
  getResidentRecordCounts
} = require('../actions/resident.actions');
const { createResidentNotification, refreshRoleDashboards, getInboxMessages } = require('../actions/notification.actions');
const { createAuditLog } = require('../actions/audit.actions');
const { sendAccountApprovedEmail, sendAccountDeclinedEmail } = require('../actions/email.actions');

const router = express.Router();

router.get('/staff/dashboard', requireRole('staff'), (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboards/staff_dashboard.html'));
});

router.get('/staff/inbox', requireRole('staff'), (req, res) =>
  res.sendFile(path.join(__dirname, '../dashboards/staff_inbox.html'))
);

router.get('/api/staff/inbox', requireRole('staff'), async (req, res) => {
  const rows = await getInboxMessages('staff');
  res.json(rows);
});

router.get('/staff/request/:id', requireRole('staff'), (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboards/staff_request.html'));
});

router.get('/staff/request/:id/report', requireRole('staff'), async (req, res) => {
  const request = await getRequestById(req.params.id);
  if (!request) return res.status(404).send('Request not found.');
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Request Report</title><style>body{font-family:Arial;padding:32px;color:#222}h1,h2{margin:0 0 14px}table{width:100%;border-collapse:collapse;margin-top:18px}td,th{border:1px solid #ccc;padding:10px;text-align:left}button{padding:10px 16px;margin-top:18px}</style></head><body><h1>Mabayuan Express</h1><h2>Request Details Report</h2><table><tr><th>Transaction No.</th><td>${request.transaction_no}</td></tr><tr><th>Resident Name</th><td>${request.resident_name}</td></tr><tr><th>Document</th><td>${request.document_name}</td></tr><tr><th>Status</th><td>${request.status}</td></tr><tr><th>Price</th><td>₱${Number(request.price_at_request).toFixed(2)}</td></tr><tr><th>Processing Days</th><td>${request.processing_days_at_request}</td></tr><tr><th>Suggested Release Date</th><td>${toDateInput(request.suggested_release_date) || '-'}</td></tr><tr><th>Release Date</th><td>${toDateInput(request.release_date) || '-'}</td></tr><tr><th>Purpose</th><td>${request.purpose || '-'}</td></tr><tr><th>Captain Notes</th><td>${request.captain_notes || '-'}</td></tr><tr><th>Staff Notes</th><td>${request.staff_notes || '-'}</td></tr></table><button onclick="window.print()">Print Report</button></body></html>`);
});

router.get('/api/staff/me', requireRole('staff'), (req, res) => res.json(req.session.user));

router.get('/api/staff/counts', requireRole('staff'), async (req, res) => {
  const counts = await getRoleCounts('staff');
  const result = await pool.query(`SELECT COUNT(*) AS pending_residents FROM residents WHERE status = 'Pending'`);
  const pendingResidents = result.rows[0].pending_residents;  // Correctly access the count value
  res.json({ ...counts, pending_residents: pendingResidents || 0 });
});

router.get('/api/staff/requests', requireRole('staff'), async (req, res) => res.json(await getRequestsByRole('staff', req.query.status || 'all')));

router.get('/api/staff/requests/:id', requireRole('staff'), async (req, res) => {
  const request = await getRequestById(req.params.id);
  const logs = await getRequestLogs(req.params.id);
  res.json({ request, logs });
});

router.get('/api/staff/pending-residents', requireRole('staff'), async (req, res) => {
  try {
    const pendingResidents = await getPendingResidents();
    res.json(pendingResidents);
  } catch (error) {
    console.error("Error fetching pending residents:", error);
    res.status(500).json({ error: 'Unable to retrieve pending residents.' });
  }
});

router.post('/api/staff/residents/:id/approve', requireRole('staff'), async (req, res) => {
  try {
    const residentId = req.params.id;
    const result = await pool.query(`SELECT * FROM residents WHERE resident_id = $1 LIMIT 1`, [residentId]);
    const resident = result.rows[0];  // Correctly access the first row
    if (!resident) return res.status(404).json({ error: 'Resident not found.' });

    await pool.query(`UPDATE residents SET status = 'Approved' WHERE resident_id = $1`, [residentId]);

    await createResidentNotification({
      residentId,
      title: 'Account approved',
      message: 'Your resident account has been approved. You may now log in.',
      actorUserId: req.session.user.user_id,
      actorRole: 'staff',
      eventType: 'RESIDENT_APPROVED_NOTIFICATION'
    });

    await createAuditLog({
      actorUserId: req.session.user.user_id,
      actorRole: 'staff',
      targetType: 'resident',
      targetId: residentId,
      action: 'RESIDENT_APPROVED',
      description: `Staff approved resident registration for ${resident.first_name} ${resident.last_name}.`,
      metadata: { resident_email: resident.email }
    });

    // Send approval email notification
    await sendAccountApprovedEmail({
      firstName: resident.first_name,
      lastName: resident.last_name,
      email: resident.email
    });

    refreshRoleDashboards('staff', 'system_admin');
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not approve resident.' });
  }
});

router.post('/api/staff/residents/:id/decline', requireRole('staff'), async (req, res) => {
  try {
    const residentId = req.params.id;
    const result = await pool.query(`SELECT * FROM residents WHERE resident_id = $1 LIMIT 1`, [residentId]);
    const resident = result.rows[0];  // Correctly access the first row
    if (!resident) return res.status(404).json({ error: 'Resident not found.' });

    await pool.query(`UPDATE residents SET status = 'Declined' WHERE resident_id = $1`, [residentId]);

    await createResidentNotification({
      residentId,
      title: 'Account declined',
      message: 'Your resident account was declined. Please contact the barangay office for assistance.',
      actorUserId: req.session.user.user_id,
      actorRole: 'staff',
      eventType: 'RESIDENT_DECLINED_NOTIFICATION'
    });

    await createAuditLog({
      actorUserId: req.session.user.user_id,
      actorRole: 'staff',
      targetType: 'resident',
      targetId: residentId,
      action: 'RESIDENT_DECLINED',
      description: `Staff declined resident registration for ${resident.first_name} ${resident.last_name}.`,
      metadata: { resident_email: resident.email }
    });

    // Send declined email notification
    await sendAccountDeclinedEmail({
      firstName: resident.first_name,
      lastName: resident.last_name,
      email: resident.email
    });

    refreshRoleDashboards('staff', 'system_admin');
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not decline resident.' });
  }
});

router.post('/api/staff/requests/:id/set-release', requireRole('staff'), async (req, res) => {
  try {
    const requestId = req.params.id;
    const { release_date, staff_notes } = req.body;
    const request = await getRequestById(requestId);
    if (!request) return res.status(404).send('Request not found.');

    await pool.query(
      `UPDATE requests
       SET release_date = $1, staff_notes = $2, status = 'Ready for Pickup', processed_by = $3, updated_at = NOW()
       WHERE request_id = $4`,
      [release_date, staff_notes || request.staff_notes || null, req.session.user.user_id, requestId]
    );

    await createRequestLog({
      requestId,
      actionType: 'SET_RELEASE_DATE',
      oldStatus: request.status,
      newStatus: 'Ready for Pickup',
      oldReleaseDate: request.release_date,
      newReleaseDate: release_date,
      remarks: staff_notes || null,
      changedByUserId: req.session.user.user_id,
      changedByRole: 'staff'
    });

    await createResidentNotification({
      residentId: request.resident_id,
      requestId,
      title: 'Release date set',
      message: `${request.document_name} is ready for pickup on ${release_date}.`,
      actorUserId: req.session.user.user_id,
      actorRole: 'staff',
      eventType: 'SET_RELEASE_DATE_NOTIFICATION',
      auditMeta: { old_release_date: request.release_date, new_release_date: release_date }
    });

    await createAuditLog({
      actorUserId: req.session.user.user_id,
      actorRole: 'staff',
      targetType: 'request',
      targetId: requestId,
      action: 'SET_RELEASE_DATE',
      description: `Staff set release date for ${request.transaction_no} to ${release_date} and notified the resident.`,
      metadata: {
        resident_id: request.resident_id,
        old_status: request.status,
        new_status: 'Ready for Pickup',
        old_release_date: request.release_date,
        new_release_date: release_date,
        staff_notes: staff_notes || null
      }
    });

    refreshRoleDashboards('staff', 'captain', 'system_admin');
    res.redirect(`/staff/request/${requestId}?saved=1`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Could not set release date.');
  }
});

router.post('/api/staff/requests/:id/claim', requireRole('staff'), async (req, res) => {
  try {
    const requestId = req.params.id;
    const { staff_notes } = req.body;
    const request = await getRequestById(requestId);
    if (!request) return res.status(404).send('Request not found.');

    await pool.query(
      `UPDATE requests
       SET status = 'Claimed', staff_notes = $1, claimed_at = NOW(), processed_by = $2, updated_at = NOW()
       WHERE request_id = $3`,
      [staff_notes || request.staff_notes || null, req.session.user.user_id, requestId]
    );

    await createRequestLog({
      requestId,
      actionType: 'MARK_CLAIMED',
      oldStatus: request.status,
      newStatus: 'Claimed',
      oldReleaseDate: request.release_date,
      newReleaseDate: request.release_date,
      remarks: staff_notes || null,
      changedByUserId: req.session.user.user_id,
      changedByRole: 'staff'
    });

    await createResidentNotification({
      residentId: request.resident_id,
      requestId,
      title: 'Document claimed',
      message: `${request.document_name} has been marked as claimed.`,
      actorUserId: req.session.user.user_id,
      actorRole: 'staff',
      eventType: 'MARK_CLAIMED_NOTIFICATION'
    });

    await createAuditLog({
      actorUserId: req.session.user.user_id,
      actorRole: 'staff',
      targetType: 'request',
      targetId: requestId,
      action: 'MARK_CLAIMED',
      description: `Staff marked ${request.transaction_no} as claimed and sent a resident notification.`,
      metadata: {
        resident_id: request.resident_id,
        old_status: request.status,
        new_status: 'Claimed',
        release_date: request.release_date,
        staff_notes: staff_notes || null
      }
    });

    refreshRoleDashboards('staff', 'captain', 'system_admin');
    res.redirect(`/staff/request/${requestId}?saved=1`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Could not mark request as claimed.');
  }
});

/* ═══════════════════════════════════════════════════════════════════
   2.4  RESIDENT RECORD MANAGEMENT
   ═══════════════════════════════════════════════════════════════════ */

// Page
router.get('/staff/residents', requireRole('staff'), (req, res) =>
  res.sendFile(path.join(__dirname, '../dashboards/staff_residents.html'))
);

// Summary counts
router.get('/api/staff/residents/counts', requireRole('staff'), async (req, res) => {
  try {
    const counts = await getResidentRecordCounts();
    res.json(counts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load counts.' });
  }
});

// List all residents (with optional ?status= and ?search= filters)
router.get('/api/staff/residents', requireRole('staff'), async (req, res) => {
  try {
    const rows = await getAllResidents({
      status: req.query.status || 'all',
      search: req.query.search || ''
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load residents.' });
  }
});

// Single resident detail
router.get('/api/staff/residents/:id', requireRole('staff'), async (req, res) => {
  try {
    const resident = await getResidentById(req.params.id);
    if (!resident) return res.status(404).json({ error: 'Resident not found.' });
    res.json(resident);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load resident.' });
  }
});

// Update resident record
router.post('/api/staff/residents/:id/update', requireRole('staff'), async (req, res) => {
  try {
    const residentId = req.params.id;
    const existing = await getResidentById(residentId);
    if (!existing) return res.status(404).json({ error: 'Resident not found.' });

    const { first_name, middle_name, last_name, suffix, phone_number, address, birth_date } = req.body;
    await updateResidentRecord(residentId, { first_name, middle_name, last_name, suffix, phone_number, address, birth_date });

    await createAuditLog({
      actorUserId: req.session.user.user_id,
      actorRole: 'staff',
      targetType: 'resident',
      targetId: residentId,
      action: 'RESIDENT_RECORD_UPDATED',
      description: `Staff updated record for resident ${existing.first_name} ${existing.last_name}.`,
      metadata: { email: existing.email, fields_updated: Object.keys(req.body).filter(k => req.body[k] !== undefined) }
    });

    refreshRoleDashboards('staff', 'system_admin');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update resident record.' });
  }
});

// View resident valid ID image — serves from Supabase Storage or local disk (legacy)
router.get('/api/staff/residents/:id/id-image', requireRole('staff'), async (req, res) => {
  const NOT_FOUND_PAGE = `
    <!DOCTYPE html><html><head><title>ID Not Found</title>
    <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f0f1;}
    .box{text-align:center;padding:40px;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.1);}
    h2{color:#8b2131;margin:0 0 8px;}p{color:#666;margin:0 0 20px;}
    a{color:#8b2131;font-weight:600;}</style></head>
    <body><div class="box">
      <h2>ID Image Not Found</h2>
      <p>The uploaded ID file could not be located.<br>The resident may need to re-upload their valid ID.</p>
      <a href="javascript:history.back()">← Go Back</a>
    </div></body></html>`;

  try {
    const resident = await getResidentById(req.params.id);
    if (!resident) return res.status(404).send('Resident not found.');
    if (!resident.valid_id_path) return res.status(404).send(NOT_FOUND_PAGE);

    const idPath = resident.valid_id_path;

    // NEW: Supabase Storage path (format: "supabase:bucket/filename")
    if (idPath.startsWith('supabase:')) {
      const storagePath = idPath.replace('supabase:', ''); // e.g. "valid-ids/filename.jpg"
      const [bucket, ...fileParts] = storagePath.split('/');
      const fileName = fileParts.join('/');

      const { data, error } = await supabase.storage.from(bucket).download(fileName);
      if (error || !data) {
        console.error('Supabase Storage download error:', error);
        return res.status(404).send(NOT_FOUND_PAGE);
      }

      const ext = path.extname(fileName).toLowerCase();
      const mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf' };
      res.setHeader('Content-Type', mimeTypes[ext] || data.type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);

      // Convert Blob to Buffer and send
      const buffer = Buffer.from(await data.arrayBuffer());
      return res.send(buffer);
    }

    // LEGACY: Local disk path (format: "/uploads/ids/filename.jpg")
    const absolutePath = path.join(__dirname, '..', idPath.replace(/^\//, ''));
    if (!fs.existsSync(absolutePath)) return res.status(404).send(NOT_FOUND_PAGE);

    const ext = path.extname(absolutePath).toLowerCase();
    const mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf' };
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(absolutePath)}"`);
    fs.createReadStream(absolutePath).pipe(res);

  } catch (err) {
    console.error('Error serving ID image:', err);
    res.status(500).send('Could not load ID image.');
  }
});

module.exports = router;