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
    ORDER BY r.created_at ASC
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

// ── Document Generator — per document type ─────────────────────────────────
router.get('/staff/request/:id/document', requireRole('staff'), async (req, res) => {
  const request = await getRequestById(req.params.id);
  if (!request) return res.status(404).send('Request not found.');

  const allowedStatuses = ['Approved', 'Ready for Pickup', 'Claimed'];
  if (!allowedStatuses.includes(request.status)) {
    return res.status(403).send('Document can only be printed after Captain approval.');
  }

  const fullName = [
    request.first_name,
    request.middle_name ? request.middle_name + ' ' : '',
    request.last_name,
    request.suffix ? ' ' + request.suffix : ''
  ].join(' ').replace(/\s+/g, ' ').trim();

  const address = request.address || 'Barangay Mabayuan, Olongapo City, Zambales';
  const purpose = request.purpose || '—';
  const txn     = request.transaction_no;
  const captain = 'Hon. Edwin M. Esposo';
  const captainTitle = 'Punong Barangay, Barangay Mabayuan';

  const issuedDate = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });

  // Validity: 6 months from today
  const validUntil = new Date();
  validUntil.setMonth(validUntil.getMonth() + 6);
  const validityDate = validUntil.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });

  const docName = (request.document_name || '').trim().toLowerCase();

  // ── Document body per type ──────────────────────────────────────────────
  let docTitle = request.document_name.toUpperCase();
  let orNumber = `OR-${txn.replace('TXN-','')}`;
  let body = '';

  if (docName.includes('clearance')) {
    body = `
      <p>TO WHOM IT MAY CONCERN:</p>
      <p>This is to certify that <strong>${fullName}</strong>, of legal age, a bonafide resident of <strong>${address}</strong>, is personally known to me and has been a resident of this Barangay.</p>
      <p>Further, this certifies that he/she is of good moral character and has no derogatory record filed in this office.</p>
      <p>This certification is issued upon request of the above-named person for <strong>${purpose}</strong> and for whatever legal purpose it may serve.</p>`;
  } else if (docName.includes('residency')) {
    body = `
      <p>TO WHOM IT MAY CONCERN:</p>
      <p>This is to certify that <strong>${fullName}</strong>, of legal age, is a bonafide resident of <strong>${address}</strong> and has been continuously residing in the said address.</p>
      <p>This certification is issued upon request of the above-named person for <strong>${purpose}</strong> and for whatever legal purpose it may serve.</p>`;
  } else if (docName.includes('indigency')) {
    body = `
      <p>TO WHOM IT MAY CONCERN:</p>
      <p>This is to certify that <strong>${fullName}</strong>, of legal age, a resident of <strong>${address}</strong>, belongs to an indigent family in this Barangay and is in need of financial assistance.</p>
      <p>This certification is issued upon request of the above-named person for <strong>${purpose}</strong> and for whatever legal purpose it may serve.</p>`;
  } else if (docName.includes('business permit') || docName.includes('business')) {
    body = `
      <p>TO WHOM IT MAY CONCERN:</p>
      <p>This is to certify that <strong>${fullName}</strong>, of legal age, a resident of <strong>${address}</strong>, has been granted a Barangay Business Permit to operate a business within the jurisdiction of Barangay Mabayuan, Olongapo City, Zambales.</p>
      <p>This permit is issued upon request for <strong>${purpose}</strong> and subject to existing ordinances and regulations of the barangay.</p>`;
  } else if (docName.includes('cedula') || docName.includes('community tax')) {
    docTitle = 'COMMUNITY TAX CERTIFICATE (CEDULA)';
    body = `
      <p>This is to certify that <strong>${fullName}</strong>, residing at <strong>${address}</strong>, has paid the Community Tax for the current year.</p>
      <p>Issued for <strong>${purpose}</strong>.</p>`;
  } else {
    body = `
      <p>TO WHOM IT MAY CONCERN:</p>
      <p>This is to certify that <strong>${fullName}</strong>, of legal age, a bonafide resident of <strong>${address}</strong>, has requested and been issued this <strong>${request.document_name}</strong>.</p>
      <p>This certification is issued upon request for <strong>${purpose}</strong> and for whatever legal purpose it may serve.</p>`;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${request.document_name} — ${fullName}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Times New Roman',Times,serif;background:#f0eded;min-height:100vh;padding:24px 16px;color:#1a0a0c;font-size:14px}
    .doc-outer{max-width:720px;margin:0 auto;background:#fff;border:1px solid #ddd;box-shadow:0 4px 24px rgba(0,0,0,.12)}

    /* Triple border effect */
    .doc-border-outer{padding:10px;border:3px solid #8b2131}
    .doc-border-inner{padding:8px;border:1px solid #8b2131}
    .doc-content{padding:28px 36px}

    /* Header */
    .doc-header{text-align:center;border-bottom:2px solid #8b2131;padding-bottom:18px;margin-bottom:22px;position:relative}
    .doc-header .republic{font-size:11px;letter-spacing:.06em;color:#555;margin-bottom:2px}
    .doc-header .province{font-size:11px;color:#555;margin-bottom:12px}
    .header-row{display:flex;align-items:center;justify-content:center;gap:20px;margin-bottom:10px}
    .seal{width:72px;height:72px;border-radius:50%;border:2px solid #8b2131;display:flex;align-items:center;justify-content:center;background:#fdf8f8;flex-shrink:0}
    .seal svg{width:48px;height:48px}
    .brgy-name{font-size:22px;font-weight:700;color:#8b2131;letter-spacing:.02em}
    .brgy-sub{font-size:11px;color:#666;margin-top:2px}
    .doc-type-title{font-size:17px;font-weight:700;letter-spacing:.08em;color:#1a0a0c;margin-top:14px;text-decoration:underline}

    /* Body */
    .doc-body-text p{margin-bottom:16px;line-height:1.9;text-align:justify;text-indent:40px}
    .doc-body-text p:first-child{text-indent:0}

    /* Details table */
    .doc-details{width:100%;border-collapse:collapse;margin:18px 0;font-size:13px}
    .doc-details td{padding:5px 10px;vertical-align:top}
    .doc-details td:first-child{width:38%;color:#555;font-style:italic}
    .doc-details td:last-child{font-weight:600;color:#1a0a0c;border-bottom:1px dotted #ccc}

    /* Signature */
    .signature-section{margin-top:40px;display:flex;justify-content:space-between;align-items:flex-end}
    .sig-issued{font-size:12px;color:#555}
    .sig-block{text-align:center;min-width:220px}
    .sig-line{border-top:1.5px solid #1a0a0c;margin-bottom:4px;margin-top:50px}
    .sig-name{font-weight:700;font-size:14px;color:#8b2131}
    .sig-title{font-size:11px;color:#555;margin-top:2px}

    /* OR / Control no */
    .control-row{display:flex;justify-content:space-between;font-size:11px;color:#888;margin-top:18px;padding-top:10px;border-top:1px solid #eee}

    /* Footer watermark */
    .doc-footer{text-align:center;font-size:10px;color:#aaa;padding:10px 0 4px;font-style:italic}

    /* Print button bar */
    .print-bar{display:flex;gap:10px;justify-content:flex-end;padding:14px 16px;background:#fdf8f8;border-top:1px solid #e8d5d7}
    .btn{padding:9px 22px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;border:none;transition:.15s;font-family:Arial,sans-serif}
    .btn-primary{background:linear-gradient(135deg,#4a1e24,#8b2131);color:#fff}
    .btn-ghost{background:#fff;border:1.5px solid #e8d5d7;color:#8b2131}

    @media print{
      body{background:#fff;padding:0}
      .doc-outer{box-shadow:none;border:none;max-width:100%}
      .doc-border-outer{border-color:#8b2131;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .print-bar{display:none}
      @page{size:letter portrait;margin:15mm 12mm}
    }
  </style>
</head>
<body>
<div class="doc-outer">
  <div class="doc-border-outer">
    <div class="doc-border-inner">
      <div class="doc-content">

        <!-- Header -->
        <div class="doc-header">
          <div class="republic">Republic of the Philippines</div>
          <div class="province">City of Olongapo · Province of Zambales</div>
          <div class="header-row">
            <div class="seal">
              <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="18" cy="18" r="17" stroke="#8b2131" stroke-width="1.5" fill="#fff"/>
                <rect x="9" y="7" width="12" height="16" rx="2" fill="rgba(139,33,49,0.18)"/>
                <path d="M17 7 L21 11 L17 11 Z" fill="rgba(139,33,49,0.15)"/>
                <line x1="11" y1="13" x2="19" y2="13" stroke="#8b2131" stroke-width="1.2" stroke-linecap="round"/>
                <line x1="11" y1="16" x2="19" y2="16" stroke="#8b2131" stroke-width="1.2" stroke-linecap="round"/>
                <line x1="11" y1="19" x2="16" y2="19" stroke="#8b2131" stroke-width="1.2" stroke-linecap="round"/>
                <circle cx="25" cy="27" r="5" fill="#8b2131"/>
                <polyline points="22.5,27 24.5,29 27.5,24.5" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
              </svg>
            </div>
            <div>
              <div class="brgy-name">BARANGAY MABAYUAN</div>
              <div class="brgy-sub">Olongapo City, Zambales</div>
            </div>
          </div>
          <div class="doc-type-title">${docTitle}</div>
        </div>

        <!-- Details -->
        <table class="doc-details">
          <tr><td>Transaction No.</td><td>${txn}</td></tr>
          <tr><td>Resident Name</td><td>${fullName}</td></tr>
          <tr><td>Address</td><td>${address}</td></tr>
          <tr><td>Date Issued</td><td>${issuedDate}</td></tr>
          <tr><td>Valid Until</td><td>${validityDate}</td></tr>
        </table>

        <!-- Body -->
        <div class="doc-body-text">
          ${body}
        </div>

        <!-- Signature -->
        <div class="signature-section">
          <div class="sig-issued">
            Issued at Barangay Mabayuan<br/>
            Olongapo City, Zambales<br/>
            ${issuedDate}
          </div>
          <div class="sig-block">
            <div class="sig-line"></div>
            <div class="sig-name">${captain}</div>
            <div class="sig-title">${captainTitle}</div>
          </div>
        </div>

        <!-- Control / OR -->
        <div class="control-row">
          <span>O.R. No.: ${orNumber}</span>
          <span>Amount Paid: ₱${Number(request.price_at_request).toFixed(2)}</span>
          <span>Doc Stamp: ____________</span>
        </div>

      </div>
    </div>
  </div>
  <div class="doc-footer">This document is valid for 6 months from date of issuance. Not valid without official seal.</div>
  <div class="print-bar">
    <button class="btn btn-ghost" onclick="window.close()">✕ Close</button>
    <button class="btn btn-primary" onclick="window.print()">🖨 Print Document</button>
  </div>
</div>
</body>
</html>`;

  res.send(html);
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

// Archive a resident
router.post('/api/staff/residents/:id/archive', requireRole('staff'), async (req, res) => {
  try {
    const residentId = req.params.id;
    const result = await pool.query(`SELECT * FROM residents WHERE resident_id = $1 LIMIT 1`, [residentId]);
    const resident = result.rows[0];
    if (!resident) return res.status(404).json({ error: 'Resident not found.' });

    await pool.query(`UPDATE residents SET is_archived = TRUE WHERE resident_id = $1`, [residentId]);

    await createAuditLog({
      actorUserId: req.session.user.user_id,
      actorRole: 'staff',
      targetType: 'resident',
      targetId: residentId,
      action: 'RESIDENT_ARCHIVED',
      description: `Staff archived resident ${resident.first_name} ${resident.last_name}.`,
      metadata: { resident_email: resident.email }
    });

    refreshRoleDashboards('staff', 'system_admin');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not archive resident.' });
  }
});

// Unarchive a resident
router.post('/api/staff/residents/:id/unarchive', requireRole('staff'), async (req, res) => {
  try {
    const residentId = req.params.id;
    const result = await pool.query(`SELECT * FROM residents WHERE resident_id = $1 LIMIT 1`, [residentId]);
    const resident = result.rows[0];
    if (!resident) return res.status(404).json({ error: 'Resident not found.' });

    await pool.query(`UPDATE residents SET is_archived = FALSE WHERE resident_id = $1`, [residentId]);

    await createAuditLog({
      actorUserId: req.session.user.user_id,
      actorRole: 'staff',
      targetType: 'resident',
      targetId: residentId,
      action: 'RESIDENT_UNARCHIVED',
      description: `Staff unarchived resident ${resident.first_name} ${resident.last_name}.`,
      metadata: { resident_email: resident.email }
    });

    refreshRoleDashboards('staff', 'system_admin');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not unarchive resident.' });
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

// List all residents (with optional ?status= and ?search= and ?archived= filters)
router.get('/api/staff/residents', requireRole('staff'), async (req, res) => {
  try {
    const rows = await getAllResidents({
      status: req.query.status || 'all',
      search: req.query.search || '',
      archived: req.query.archived === 'true'
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

    const { email, phone_number, address } = req.body;
    await updateResidentRecord(residentId, {
      first_name: existing.first_name,
      middle_name: existing.middle_name,
      last_name: existing.last_name,
      suffix: existing.suffix,
      birth_date: existing.birth_date,
      email: email || existing.email,
      phone_number: phone_number || existing.phone_number,
      address: address || existing.address
    });

    await createAuditLog({
      actorUserId: req.session.user.user_id,
      actorRole: 'staff',
      targetType: 'resident',
      targetId: residentId,
      action: 'RESIDENT_RECORD_UPDATED',
      description: `Staff updated record for resident ${existing.first_name} ${existing.last_name}.`,
      metadata: { fields_updated: ['email', 'phone_number', 'address'] }
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