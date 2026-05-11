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
const { sendAccountApprovedEmail, sendAccountDeclinedEmail, sendReadyForPickupEmail } = require('../actions/email.actions');

const router = express.Router();

router.get('/staff/dashboard', requireRole('staff'), (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboards/staff_dashboard.html'));
});

router.get('/staff/report', requireRole('staff'), (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboards/staff_report.html'));
});

router.get('/api/staff/report', requireRole('staff'), async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      r.request_id, r.transaction_no, r.document_name,
      r.price_at_request, r.status,
      r.suggested_release_date, r.release_date,
      r.updated_at, r.created_at,
      res.last_name || ', ' || res.first_name AS resident_name
    FROM requests r
    JOIN residents res ON res.resident_id = r.resident_id
    WHERE r.status IN ('Approved','Ready for Pickup','Claimed')
    ORDER BY r.updated_at DESC
  `);
  res.json(rows);
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
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Request Report — ${request.transaction_no}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;background:#f5f0f1;min-height:100vh;padding:24px 16px;color:#2d1518}
    .card{background:#fff;border-radius:16px;max-width:640px;margin:0 auto;overflow:hidden;box-shadow:0 8px 32px rgba(68,29,34,.12)}
    .card-head{background:linear-gradient(135deg,#4a1e24,#8b2131);color:#fff;padding:24px 28px}
    .card-head .org{font-size:12px;opacity:.75;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px}
    .card-head h1{font-size:20px;font-weight:800;margin-bottom:2px}
    .card-head .txn{font-size:12px;opacity:.7;font-family:monospace}
    .card-body{padding:24px 28px}
    .section-title{font-size:11px;font-weight:700;color:#8b2131;text-transform:uppercase;letter-spacing:.08em;margin:20px 0 10px;padding-bottom:6px;border-bottom:1.5px solid #f0e4e5}
    .section-title:first-child{margin-top:0}
    .row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:8px 0;border-bottom:1px solid #f5edef;font-size:13.5px}
    .row:last-child{border-bottom:none}
    .row .lbl{color:#9a7a7d;font-weight:600;font-size:12px;min-width:140px;flex-shrink:0}
    .row .val{color:#2d1518;font-weight:500;text-align:right;word-break:break-word}
    .badge{display:inline-flex;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700}
    .b-approved,.b-processing{background:#e7f2ff;color:#0f4fa8}
    .b-ready{background:#e9f9ec;color:#16a34a}
    .b-claimed{background:#e9f9ec;color:#16a34a}
    .b-declined{background:#fdeaea;color:#dc2626}
    .b-pending{background:#fff1d8;color:#b45309}
    .purpose-box{background:#fdf8f8;border:1px solid #f0e4e5;border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.65;margin-top:6px;word-break:break-word}
    .card-foot{padding:18px 28px;border-top:1px solid #f0e4e5;display:flex;gap:10px;justify-content:flex-end;background:#fdf8f8}
    .btn{padding:10px 22px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;border:none;transition:.15s}
    .btn-primary{background:linear-gradient(135deg,#4a1e24,#8b2131);color:#fff;box-shadow:0 4px 12px rgba(74,30,36,.3)}
    .btn-ghost{background:#fff;border:1.5px solid #e8d5d7;color:#8b2131}
    .generated{font-size:11px;color:#b0989a;text-align:center;padding:10px;font-style:italic}
    @media print{
      body{background:#fff;padding:0}
      .card{box-shadow:none;border-radius:0;max-width:100%}
      .card-head{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .card-foot{display:none}
    }
    @media(max-width:500px){
      .card-head,.card-body,.card-foot{padding:18px 16px}
      .row{flex-direction:column;gap:3px}
      .row .val{text-align:left}
      .row .lbl{min-width:unset}
    }
  </style>
</head>
<body>
<div class="card">
  <div class="card-head">
    <div class="org">Republic of the Philippines · Barangay Mabayuan</div>
    <h1>📄 Request Details Report</h1>
    <div class="txn">${request.transaction_no}</div>
  </div>
  <div class="card-body">
    <div class="section-title">Resident Information</div>
    <div class="row"><span class="lbl">Resident Name</span><span class="val">${request.resident_name || '—'}</span></div>

    <div class="section-title">Request Information</div>
    <div class="row"><span class="lbl">Transaction No.</span><span class="val" style="font-family:monospace;font-size:12px">${request.transaction_no}</span></div>
    <div class="row"><span class="lbl">Document</span><span class="val">${request.document_name}</span></div>
    <div class="row"><span class="lbl">Price</span><span class="val">₱${Number(request.price_at_request).toFixed(2)}</span></div>
    <div class="row"><span class="lbl">Processing Days</span><span class="val">${request.processing_days_at_request} day${request.processing_days_at_request !== 1 ? 's' : ''}</span></div>
    <div class="row"><span class="lbl">Status</span><span class="val"><span class="badge b-${(request.status||'').toLowerCase().replace(/[^a-z]+/g,'-')}">${request.status === 'Approved' ? 'Processing' : request.status}</span></span></div>
    <div class="row"><span class="lbl">Suggested Release</span><span class="val">${toDateInput(request.suggested_release_date) || '—'}</span></div>
    <div class="row"><span class="lbl">Release Date</span><span class="val">${toDateInput(request.release_date) || '—'}</span></div>

    <div class="section-title">Purpose</div>
    <div class="purpose-box">${request.purpose || '—'}</div>

    ${request.captain_notes ? `<div class="section-title">Captain Notes</div><div class="purpose-box">${request.captain_notes}</div>` : ''}
    ${request.staff_notes ? `<div class="section-title">Staff Notes</div><div class="purpose-box">${request.staff_notes}</div>` : ''}

    <div class="generated">Generated on ${new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
  </div>
  <div class="card-foot">
    <button class="btn btn-ghost" onclick="window.close()">Close</button>
    <button class="btn btn-primary" onclick="window.print()">🖨 Print Report</button>
  </div>
</div>
</body>
</html>`);
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
    const { reason } = req.body;
    const result = await pool.query(`SELECT * FROM residents WHERE resident_id = $1 LIMIT 1`, [residentId]);
    const resident = result.rows[0];
    if (!resident) return res.status(404).json({ error: 'Resident not found.' });

    const declineReason = reason || 'No reason provided. Please contact the barangay office for assistance.';

    await pool.query(`UPDATE residents SET status = 'Declined' WHERE resident_id = $1`, [residentId]);

    await createResidentNotification({
      residentId,
      title: 'Account declined',
      message: `Your resident account was declined. Reason: ${declineReason}`,
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
      description: `Staff declined resident registration for ${resident.first_name} ${resident.last_name}. Reason: ${declineReason}`,
      metadata: { resident_email: resident.email, reason: declineReason }
    });

    // Send declined email with reason
    await sendAccountDeclinedEmail({
      firstName: resident.first_name,
      lastName: resident.last_name,
      email: resident.email,
      reason: declineReason
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

    // Prevent past dates — compare as date strings (YYYY-MM-DD) in PHT (UTC+8)
    const nowPHT = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const today = nowPHT.toISOString().slice(0, 10);
    if (!release_date || release_date < today) {
      return res.status(400).json({ error: `Release date cannot be in the past. Today is ${today}.` });
    }

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

    // Send email notification to resident
    await sendReadyForPickupEmail({
      firstName: request.first_name,
      lastName: request.last_name,
      email: request.email,
      documentName: request.document_name,
      releaseDate: release_date,
      transactionNo: request.transaction_no
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