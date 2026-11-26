/**
 * Resident profile changes that need email verification (new email, new password).
 * A 6-digit code is emailed; only its hash is stored. Codes expire after 10 minutes,
 * allow 5 attempts, and can be re-sent after 60 seconds.
 */
const crypto = require('crypto');
const pool = require('../db');
const { sendBrevoEmail } = require('./email.actions');

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_AFTER_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

const hashCode = (id, code) => crypto.createHash('sha256').update(`${id}:${code}:${process.env.SESSION_SECRET || 'mx'}`).digest('hex');
const maskEmail = e => String(e).replace(/^(.{2})[^@]*(@.*)$/, (_, a, b) => a + '•••' + b);

function codeEmailHtml({ firstName, title, intro, code }) {
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;border:1px solid #eadcdd;border-radius:14px;">
    <h2 style="margin:0 0 8px;color:#8b2131;">${title}</h2>
    <p style="color:#3d2326;margin:0 0 6px;">Hi ${firstName || 'there'},</p>
    <p style="color:#5b4648;margin:0 0 22px;">${intro} The code expires in <strong>10 minutes</strong>.</p>
    <div style="font-size:34px;font-weight:700;letter-spacing:8px;text-align:center;padding:18px;background:#fdf6f7;border-radius:10px;color:#2d1518;">${code}</div>
    <p style="color:#8a7f80;font-size:13px;margin-top:22px;">If you didn't ask for this, you can ignore this email — nothing will change. Never share this code with anyone, including barangay staff.</p>
  </div>`;
}

function noticeEmailHtml({ firstName, title, body }) {
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;border:1px solid #eadcdd;border-radius:14px;">
    <h2 style="margin:0 0 8px;color:#8b2131;">${title}</h2>
    <p style="color:#3d2326;margin:0 0 10px;">Hi ${firstName || 'there'},</p>
    <p style="color:#5b4648;margin:0 0 14px;line-height:1.6;">${body}</p>
    <p style="color:#8a7f80;font-size:13px;margin:0;">If this wasn't you, reset your password right away and contact the Barangay Mabayuan office.</p>
  </div>`;
}

/**
 * Start a verified change. Replaces any earlier pending change of the same kind.
 * @param {'email'|'password'} purpose
 * @returns {{ sentTo: string, expiresInSec: number }}
 */
async function startChange({ resident, purpose, sendTo, newEmail = null, newPasswordHash = null }) {
  const { rows: [recent] } = await pool.query(
    `SELECT created_at FROM profile_verifications WHERE resident_id = $1 AND purpose = $2 AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`, [resident.resident_id, purpose]);
  if (recent && Date.now() - new Date(recent.created_at).getTime() < RESEND_AFTER_MS) {
    const wait = Math.ceil((RESEND_AFTER_MS - (Date.now() - new Date(recent.created_at).getTime())) / 1000);
    const err = new Error(`Please wait ${wait} seconds before requesting another code.`);
    err.status = 429;
    throw err;
  }

  const code = String(crypto.randomInt(100000, 1000000));
  await pool.query(`DELETE FROM profile_verifications WHERE resident_id = $1 AND purpose = $2`, [resident.resident_id, purpose]);
  const { rows: [row] } = await pool.query(
    `INSERT INTO profile_verifications (resident_id, purpose, new_email, new_password_hash, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, 'pending', $5) RETURNING verification_id`,
    [resident.resident_id, purpose, newEmail, newPasswordHash, new Date(Date.now() + CODE_TTL_MS)]);
  await pool.query(`UPDATE profile_verifications SET code_hash = $1 WHERE verification_id = $2`, [hashCode(row.verification_id, code), row.verification_id]);

  const isEmail = purpose === 'email';
  try {
    await sendBrevoEmail({
      to: sendTo,
      subject: isEmail ? 'Mabayuan Express — Confirm your new email' : 'Mabayuan Express — Confirm your password change',
      html: codeEmailHtml({
        firstName: resident.first_name,
        title: isEmail ? 'Confirm your new email' : 'Confirm your password change',
        intro: isEmail
          ? 'Enter this code in your Mabayuan Express profile to start using this email address for your account.'
          : 'Enter this code in your Mabayuan Express profile to finish changing your password.',
        code,
      }),
    });
  } catch (err) {
    await pool.query(`DELETE FROM profile_verifications WHERE verification_id = $1`, [row.verification_id]);
    console.error('Verification email failed:', err.message);
    const e = new Error('We could not send the verification email right now. Please try again in a few minutes.');
    e.status = 502;
    throw e;
  }
  return { sentTo: maskEmail(sendTo), expiresInSec: CODE_TTL_MS / 1000 };
}

/**
 * Check a code. On success marks it used and returns the pending change.
 * Throws an Error with .status on failure.
 */
async function confirmChange({ residentId, purpose, code }) {
  const { rows: [v] } = await pool.query(
    `SELECT * FROM profile_verifications WHERE resident_id = $1 AND purpose = $2 AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`, [residentId, purpose]);
  const fail = (msg, status = 400) => { const e = new Error(msg); e.status = status; throw e; };
  if (!v) fail('There is no pending change. Please start again.');
  if (new Date(v.expires_at) < new Date()) fail('This code has expired. Please request a new one.');
  if (v.attempts >= MAX_ATTEMPTS) fail('Too many incorrect attempts. Please request a new code.', 429);
  if (!/^\d{6}$/.test(String(code || '').trim()) || hashCode(v.verification_id, String(code).trim()) !== v.code_hash) {
    const { rows: [u] } = await pool.query(
      `UPDATE profile_verifications SET attempts = attempts + 1 WHERE verification_id = $1 RETURNING attempts`, [v.verification_id]);
    const left = MAX_ATTEMPTS - u.attempts;
    fail(left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many incorrect attempts. Please request a new code.', left > 0 ? 400 : 429);
  }
  await pool.query(`UPDATE profile_verifications SET consumed_at = NOW() WHERE verification_id = $1`, [v.verification_id]);
  return v;
}

async function cancelChange(residentId, purpose) {
  await pool.query(`DELETE FROM profile_verifications WHERE resident_id = $1 AND purpose = $2 AND consumed_at IS NULL`, [residentId, purpose]);
}

/** Pending change (if any) so the page can resume the "enter code" step after a refresh. */
async function pendingChanges(residentId) {
  const { rows } = await pool.query(
    `SELECT purpose, new_email, expires_at, created_at FROM profile_verifications
     WHERE resident_id = $1 AND consumed_at IS NULL AND expires_at > NOW() AND attempts < $2`, [residentId, MAX_ATTEMPTS]);
  return rows;
}

async function sendNotice({ to, firstName, title, body }) {
  try { await sendBrevoEmail({ to, subject: `Mabayuan Express — ${title}`, html: noticeEmailHtml({ firstName, title, body }) }); }
  catch (err) { console.error('Notice email failed:', err.message); }
}

module.exports = { startChange, confirmChange, cancelChange, pendingChanges, sendNotice, maskEmail, RESEND_AFTER_MS };
