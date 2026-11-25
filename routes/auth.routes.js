const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { sendRegistrationReceivedEmail } = require('../actions/email.actions');
const pool = require('../db');
const { createAuditLog } = require('../actions/audit.actions');
const { sendOTP, verifyOTP } = require('../actions/otp.actions');
const { noCache } = require('../middleware/auth');

const router = express.Router();

// Use memory storage — files are uploaded to Supabase Storage, not local disk
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function isStrongPassword(p) {
  return p.length >= 8 && /[a-zA-Z]/.test(p) && /[0-9]/.test(p) && /[^a-zA-Z0-9]/.test(p);
}
function redirectWithError(res, page, msg) {
  return res.redirect(`${page}?error=${encodeURIComponent(msg)}`);
}

const ROLE_DASHBOARD = {
  system_admin: '/system-admin/dashboard',
  captain: '/captain/dashboard',
  staff: '/staff/dashboard'
};

// ── Landing ───────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  noCache(res);
  if (req.session.resident) return res.redirect('/resident/dashboard');
  if (req.session.user) return res.redirect(ROLE_DASHBOARD[req.session.user.role] || '/login');
  res.sendFile(path.join(__dirname, '../views/index.html'));
});

// ── Resident ──────────────────────────────────────────────────────────────────


router.get('/resident/register', (req, res) => {
  noCache(res);
  if (req.session.resident) return res.redirect('/resident/dashboard');
  res.sendFile(path.join(__dirname, '../views/resident_register.html'));
});

// ── Personnel — single login page, smart routing ──────────────────────────────
router.get('/login', (req, res) => {
  noCache(res);
  if (req.session.user) return res.redirect(ROLE_DASHBOARD[req.session.user.role] || '/login');
  if (req.session.resident) return res.redirect('/resident/dashboard');
  res.sendFile(path.join(__dirname, '../views/login.html'));
});

// Keep old login URLs — all redirect to unified /login
router.get('/portal/login', (req, res) => { noCache(res); res.redirect('/login'); });
router.get('/resident/login', (req, res) => { noCache(res); res.redirect('/login'); });
router.get('/admin/login',    (req, res) => { noCache(res); res.redirect('/login'); });
router.get('/login/staff',    (req, res) => { noCache(res); res.redirect('/login'); });
router.get('/login/captain',  (req, res) => { noCache(res); res.redirect('/login'); });
router.get('/login/sysadmin', (req, res) => { noCache(res); res.redirect('/login'); });

// ── Forgot password ───────────────────────────────────────────────────────────
router.get('/forgot-password', (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, '../views/forgot_password.html'));
});

// ── Session check ─────────────────────────────────────────────────────────────
router.get('/api/session-check', (req, res) => {
  noCache(res);
  if (req.session.resident) return res.json({ ok: true, role: 'resident' });
  if (req.session.user) return res.json({ ok: true, role: req.session.user.role });
  // Return appropriate login page based on referer
  const referer = req.headers.referer || '';
  const isResident = referer.includes('/resident/');
  res.json({ ok: false, redirect: isResident ? '/login' : '/login' });
});

// Accepted ID types and upload helpers are shared with the document request form
const { VALID_ID_TYPES, ALLOWED_UPLOAD_MIME, uploadToStorage } = require('../actions/upload.actions');
const GENDERS = ['Male', 'Female', 'Prefer not to say'];
const uploadRegistrationFile = (file, folder, email) => uploadToStorage(file, folder, email);

// ── Resident Register ─────────────────────────────────────────────────────────
const registerUpload = upload.fields([
  { name: 'valid_id', maxCount: 1 },
  { name: 'residency_cert', maxCount: 1 },
]);
router.post('/auth/resident/register', (req, res, next) => {
  registerUpload(req, res, err => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Each uploaded file must be 5MB or smaller.' : 'File upload failed. Please try again.';
      return redirectWithError(res, '/resident/register', msg);
    }
    next();
  });
}, async (req, res) => {
  try {
    const { first_name, middle_name, last_name, suffix, birth_date, phone_number, address, email, password, confirm_password, valid_id_type, gender } = req.body;
    if (!GENDERS.includes(gender)) return redirectWithError(res, '/resident/register', 'Please choose your gender.');
    const validIdFile = req.files?.valid_id?.[0];
    const residencyFile = req.files?.residency_cert?.[0];
    if (!VALID_ID_TYPES.includes(valid_id_type)) return redirectWithError(res, '/resident/register', 'Please select the type of valid ID you are uploading.');
    if (!validIdFile) return redirectWithError(res, '/resident/register', 'Valid ID is required.');
    if (!residencyFile) return redirectWithError(res, '/resident/register', 'Barangay Certificate of Residency is required.');
    if (!ALLOWED_UPLOAD_MIME.test(validIdFile.mimetype) || !ALLOWED_UPLOAD_MIME.test(residencyFile.mimetype)) {
      return redirectWithError(res, '/resident/register', 'Uploads must be an image (JPG, PNG, GIF, WEBP) or PDF.');
    }
    if (password !== confirm_password) return redirectWithError(res, '/resident/register', 'Passwords do not match.');
    if (!isStrongPassword(password)) return redirectWithError(res, '/resident/register', 'Password must be at least 8 characters and include a letter, a number, and a special character.');

    // Age validation — must be 18+
    if (birth_date) {
      const birth = new Date(birth_date);
      const today = new Date();
      const age18 = new Date(birth.getFullYear() + 18, birth.getMonth(), birth.getDate());
      if (age18 > today) return redirectWithError(res, '/resident/register', 'You must be at least 18 years old to register.');
    } else {
      return redirectWithError(res, '/resident/register', 'Please enter your birth date.');
    }
    const { rows: existing } = await pool.query('SELECT resident_id FROM residents WHERE email=$1', [email]);
    if (existing.length) return redirectWithError(res, '/resident/register', 'Email already exists.');
    const hash = await bcrypt.hash(password, 10);

    // Upload valid ID and Certificate of Residency to Supabase Storage (persists across redeploys)
    const validIdPath = await uploadRegistrationFile(validIdFile, '', email);
    if (!validIdPath) return redirectWithError(res, '/resident/register', 'Failed to upload ID. Please try again.');
    const residencyCertPath = await uploadRegistrationFile(residencyFile, 'residency-certs', email);
    if (!residencyCertPath) return redirectWithError(res, '/resident/register', 'Failed to upload Certificate of Residency. Please try again.');

    const { rows: result } = await pool.query(
      `INSERT INTO residents (first_name,middle_name,last_name,suffix,email,password_hash,status,birth_date,phone_number,address,valid_id_path,valid_id_type,residency_cert_path,gender)
       VALUES ($1,$2,$3,$4,$5,$6,'Pending',$7,$8,$9,$10,$11,$12,$13) RETURNING resident_id`,
      [first_name, middle_name||null, last_name, suffix||null, email, hash, birth_date||null, phone_number||null, address||null, validIdPath, valid_id_type, residencyCertPath, gender]
    );
    await createAuditLog({ actorRole:'resident', targetType:'resident', targetId:result[0].resident_id, action:'RESIDENT_REGISTERED', description:`Resident registration submitted for ${first_name} ${last_name}.`, metadata:{email, valid_id_type} });

    // Send registration confirmation email
    await sendRegistrationReceivedEmail({ firstName: first_name, lastName: last_name, email });

    res.redirect('/login?registered=pending');
  } catch(e) { console.error(e); redirectWithError(res, '/resident/register', 'Registration failed. Please try again.'); }
});

// ── Resident Login ────────────────────────────────────────────────────────────
// ── Unified Login ─────────────────────────────────────────────────────────────
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    // Check residents first
    const { rows: rRows } = await pool.query('SELECT * FROM residents WHERE email=$1 LIMIT 1', [email]);
    if (rRows.length) {
      const resident = rRows[0];
      const valid = await bcrypt.compare(password, resident.password_hash);
      if (!valid) return redirectWithError(res, '/login', 'Incorrect password. Please try again.');
      if (resident.status === 'Pending')  return redirectWithError(res, '/login', 'Your account is still pending staff approval.');
      if (resident.status === 'Declined') return redirectWithError(res, '/login', 'Your account was declined. Please contact the barangay office.');
      if (resident.is_archived)           return redirectWithError(res, '/login', 'Your account has been archived. Please contact the barangay office.');
      req.session.resident = { resident_id: resident.resident_id, full_name: `${resident.first_name} ${resident.last_name}`, email: resident.email };
      delete req.session.user;
      return res.redirect('/resident/dashboard');
    }
    // Check personnel
    const { rows: uRows } = await pool.query('SELECT * FROM users WHERE email=$1 LIMIT 1', [email]);
    if (uRows.length) {
      const user = uRows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return redirectWithError(res, '/login', 'Incorrect password. Please try again.');
      req.session.user = { user_id: user.user_id, full_name: user.full_name, email: user.email, role: user.role };
      delete req.session.resident;
      return res.redirect(ROLE_DASHBOARD[user.role] || '/login');
    }
    return redirectWithError(res, '/login', 'No account found with that email address.');
  } catch(e) { console.error(e); redirectWithError(res, '/login', 'Login failed. Please try again.'); }
});

router.post('/auth/resident/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await pool.query('SELECT * FROM residents WHERE email=$1 LIMIT 1', [email]);
    if (!rows.length) return redirectWithError(res, '/login', 'No account found with that email address.');
    const resident = rows[0];
    const valid = await bcrypt.compare(password, resident.password_hash);
    if (!valid) return redirectWithError(res, '/login', 'Incorrect password. Please try again.');
    if (resident.status === 'Pending') return redirectWithError(res, '/login', 'Your account is still pending staff approval.');
    if (resident.status === 'Declined') return redirectWithError(res, '/login', 'Your account was declined. Please contact the barangay office.');
    if (resident.is_archived) return redirectWithError(res, '/login', 'Your account has been archived. Please contact the barangay office.');
    req.session.resident = { resident_id:resident.resident_id, first_name:resident.first_name, last_name:resident.last_name, email:resident.email };
    delete req.session.user;
    res.redirect('/resident/dashboard');
  } catch(e) { console.error(e); redirectWithError(res, '/login', 'Login failed. Please try again.'); }
});

// ── Personnel Login — one route, detects role, routes to correct dashboard ────
router.post('/auth/portal/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await pool.query('SELECT * FROM users WHERE email=$1 LIMIT 1', [email]);
    if (!rows.length) return redirectWithError(res, '/login', 'No account found with that email address.');
    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return redirectWithError(res, '/login', 'Incorrect password. Please try again.');

    // Set session and route based on role automatically
    req.session.user = { user_id:user.user_id, full_name:user.full_name, email:user.email, role:user.role };
    delete req.session.resident;

    const dashboard = ROLE_DASHBOARD[user.role];
    if (!dashboard) return redirectWithError(res, '/login', 'Your account role is not recognized. Please contact the administrator.');

    res.redirect(dashboard);
  } catch(e) { console.error(e); redirectWithError(res, '/login', 'Login failed. Please try again.'); }
});

// ── Forgot Password ───────────────────────────────────────────────────────────
router.post('/auth/forgot-password/send-otp', async (req, res) => {
  try {
    const { email, account_type } = req.body;
    let found = false;
    if (account_type === 'resident') {
      const { rows } = await pool.query('SELECT resident_id FROM residents WHERE email=$1', [email]);
      found = rows.length > 0;
    } else {
      const { rows } = await pool.query('SELECT user_id FROM users WHERE email=$1', [email]);
      found = rows.length > 0;
    }
    if (!found) return res.json({ ok:false, message:'No account found with that email address.' });
    await sendOTP(email);
    res.json({ ok:true, message:'OTP sent to your email. Check your inbox.' });
  } catch(e) { console.error(e); res.json({ ok:false, message:'Failed to send OTP. Check email configuration in .env.' }); }
});

router.post('/auth/forgot-password/reset', async (req, res) => {
  try {
    const { email, otp, new_password, confirm_password, account_type } = req.body;
    if (new_password !== confirm_password) return res.json({ ok:false, message:'Passwords do not match.' });
    if (!isStrongPassword(new_password)) return res.json({ ok:false, message:'Password must be at least 8 characters and include a letter, a number, and a special character.' });
    const result = verifyOTP(email, otp);
    if (!result.valid) return res.json({ ok:false, message:result.reason });
    const hash = await bcrypt.hash(new_password, 10);
    if (account_type === 'resident') {
      await pool.query('UPDATE residents SET password_hash=$1 WHERE email=$2', [hash, email]);
    } else {
      await pool.query('UPDATE users SET password_hash=$1 WHERE email=$2', [hash, email]);
    }
    res.json({ ok:true, message:'Password reset successfully. You may now log in.' });
  } catch(e) { console.error(e); res.json({ ok:false, message:'Reset failed. Please try again.' }); }
});

// ── Logout ────────────────────────────────────────────────────────────────────
router.post('/auth/logout', (req, res) => {
  // Remember who was logged in before destroying session
  const wasResident = !!req.session.resident;
  const redirectTo = wasResident ? '/login' : '/login';

  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    noCache(res);
    res.redirect(redirectTo);
  });
});

module.exports = router;
