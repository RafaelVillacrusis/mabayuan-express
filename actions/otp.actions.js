require('dotenv').config();

const otpStore = new Map();

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Send OTP via Brevo API (no SMTP - works on Render free tier)
 */
async function sendOTP(email) {
  const code = generateOTP();
  otpStore.set(email.toLowerCase(), { code, expiresAt: Date.now() + 10 * 60 * 1000 });

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      sender: {
        name: 'Mabayuan Express',
        email: process.env.BREVO_FROM
      },
      to: [{ email }],
      subject: 'Mabayuan Express — Password Reset OTP',
      htmlContent: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;">
        <h2 style="margin:0 0 8px;color:#1e293b;">Password Reset</h2>
        <p style="color:#64748b;margin:0 0 24px;">Use the code below to reset your password. Expires in <strong>10 minutes</strong>.</p>
        <div style="font-size:36px;font-weight:700;letter-spacing:8px;text-align:center;padding:20px;background:#f1f5f9;border-radius:8px;color:#0f172a;">${code}</div>
        <p style="color:#94a3b8;font-size:13px;margin-top:24px;">If you did not request this, ignore this email.</p>
      </div>`
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Brevo API error: ${response.status} - ${err}`);
  }

  return true;
}

function verifyOTP(email, code) {
  const entry = otpStore.get(email.toLowerCase());
  if (!entry) return { valid: false, reason: 'No OTP found. Please request a new one.' };
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(email.toLowerCase());
    return { valid: false, reason: 'OTP has expired. Please request a new one.' };
  }
  if (entry.code !== code.trim()) return { valid: false, reason: 'Incorrect OTP code.' };
  otpStore.delete(email.toLowerCase());
  return { valid: true };
}

module.exports = { sendOTP, verifyOTP };
