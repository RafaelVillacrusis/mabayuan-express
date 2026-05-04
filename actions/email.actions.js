require('dotenv').config();

/**
 * Send email via Brevo API (no SMTP - works on Render free tier)
 */
async function sendBrevoEmail({ to, subject, html }) {
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
      to: [{ email: to }],
      subject,
      htmlContent: html
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Brevo API error: ${response.status} - ${err}`);
  }
  return true;
}

/**
 * Send account approved email to resident
 */
async function sendAccountApprovedEmail({ firstName, lastName, email }) {
  const fullName = `${firstName} ${lastName}`;
  try {
    await sendBrevoEmail({
      to: email,
      subject: '✅ Your Mabayuan Express Account Has Been Approved',
      html: `<!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8"/>
          <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        </head>
        <body style="margin:0;padding:0;background:#f5f0f1;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0f1;padding:32px 0;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(68,29,34,.10);max-width:560px;width:100%;">

                <!-- Header -->
                <tr>
                  <td style="background:#8b2131;padding:28px 32px;text-align:center;">
                    <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
                      <tr>
                        <td style="padding-right:12px;vertical-align:middle;">
                          <!-- Document logo SVG -->
                          <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="6" y="3" width="20" height="26" rx="3" fill="rgba(255,255,255,0.22)"/>
                            <path d="M20 3 L26 9 L20 9 Z" fill="rgba(255,255,255,0.18)"/>
                            <path d="M20 3 L20 9 L26 9" stroke="rgba(255,255,255,0.55)" stroke-width="1" fill="none"/>
                            <line x1="10" y1="14" x2="22" y2="14" stroke="rgba(255,255,255,0.7)" stroke-width="1.5" stroke-linecap="round"/>
                            <line x1="10" y1="18" x2="22" y2="18" stroke="rgba(255,255,255,0.7)" stroke-width="1.5" stroke-linecap="round"/>
                            <line x1="10" y1="22" x2="17" y2="22" stroke="rgba(255,255,255,0.7)" stroke-width="1.5" stroke-linecap="round"/>
                            <circle cx="26" cy="28" r="7" fill="#fff"/>
                            <polyline points="22.5,28 25,30.5 29.5,25.5" stroke="#8b2131" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                          </svg>
                        </td>
                        <td style="vertical-align:middle;text-align:left;">
                          <div style="color:#fff;font-size:18px;font-weight:700;line-height:1.2;">Mabayuan Express</div>
                          <div style="color:rgba(255,255,255,0.75);font-size:11px;letter-spacing:0.05em;">DOCUMENT REQUEST PORTAL</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Body -->
                <tr>
                  <td style="padding:36px 32px 28px;">
                    <!-- Checkmark icon -->
                    <div style="text-align:center;margin-bottom:24px;">
                      <div style="display:inline-block;background:#e8f5ee;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;text-align:center;">✅</div>
                    </div>

                    <h1 style="margin:0 0 8px;font-size:22px;color:#2b1a1c;text-align:center;">Account Approved!</h1>
                    <p style="margin:0 0 24px;color:#736a6b;font-size:14px;text-align:center;">Your resident account has been verified by our staff.</p>

                    <p style="margin:0 0 20px;font-size:15px;color:#2b1a1c;">Hi <strong>${fullName}</strong>,</p>

                    <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.7;">
                      Great news! Your Mabayuan Express resident account has been <strong style="color:#8b2131;">approved</strong>.
                      You can now log in and request barangay documents online — anytime, without visiting the office.
                    </p>

                    <!-- What you can do box -->
                    <div style="background:#fdf6f7;border-left:4px solid #8b2131;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
                      <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#8b2131;">What you can do now:</p>
                      <ul style="margin:0;padding-left:18px;font-size:13px;color:#555;line-height:1.9;">
                        <li>Request Barangay Clearance</li>
                        <li>Request Certificate of Residency</li>
                        <li>Request Certificate of Indigency</li>
                        <li>Request Business Permit</li>
                        <li>Track your document request status</li>
                      </ul>
                    </div>

                    <!-- CTA Button -->
                    <div style="text-align:center;margin-bottom:28px;">
                      <a href="${process.env.APP_URL || 'http://localhost:3000'}/resident/login"
                         style="display:inline-block;background:#8b2131;color:#fff;text-decoration:none;padding:13px 32px;border-radius:999px;font-size:14px;font-weight:700;letter-spacing:0.02em;">
                        Log In to Your Account →
                      </a>
                    </div>

                    <p style="margin:0;font-size:13px;color:#aaa;text-align:center;">
                      If you did not register for this account, please ignore this email.
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background:#fdf6f7;border-top:1px solid #f0e4e5;padding:18px 32px;text-align:center;">
                    <p style="margin:0;font-size:12px;color:#aaa;">
                      © ${new Date().getFullYear()} Mabayuan Express · Barangay Document Request Portal<br/>
                      This email was sent from <a href="mailto:${process.env.BREVO_FROM || process.env.BREVO_USER}" style="color:#8b2131;text-decoration:none;">${process.env.BREVO_FROM || process.env.BREVO_USER}</a>
                    </p>
                  </td>
                </tr>

              </table>
            </td></tr>
          </table>
        </body>
        </html>`
    });
    console.log(`✅ Approval email sent to ${email}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send approval email to ${email}:`, err.message);
    return false;
  }
}

/**
 * Send account declined email to resident
 */
async function sendAccountDeclinedEmail({ firstName, lastName, email }) {
  const fullName = `${firstName} ${lastName}`;
  try {
    await sendBrevoEmail({
      to: email,
      subject: '❌ Your Mabayuan Express Account Was Not Approved',
      html: `<!DOCTYPE html>
        <html>
        <body style="margin:0;padding:0;background:#f5f0f1;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0f1;padding:32px 0;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(68,29,34,.10);max-width:560px;width:100%;">
                <tr>
                  <td style="background:#8b2131;padding:28px 32px;text-align:center;">
                    <div style="color:#fff;font-size:18px;font-weight:700;">Mabayuan Express</div>
                    <div style="color:rgba(255,255,255,0.75);font-size:11px;">DOCUMENT REQUEST PORTAL</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:36px 32px 28px;">
                    <div style="text-align:center;margin-bottom:24px;font-size:40px;">❌</div>
                    <h1 style="margin:0 0 8px;font-size:22px;color:#2b1a1c;text-align:center;">Account Not Approved</h1>
                    <p style="margin:0 0 24px;color:#736a6b;font-size:14px;text-align:center;">Unfortunately your registration was not approved at this time.</p>
                    <p style="margin:0 0 20px;font-size:15px;color:#2b1a1c;">Hi <strong>${fullName}</strong>,</p>
                    <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.7;">
                      We regret to inform you that your Mabayuan Express resident account registration was <strong>declined</strong>.
                      This may be due to an issue with your submitted valid ID or account details.
                    </p>
                    <div style="background:#fdf6f7;border-left:4px solid #8b2131;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
                      <p style="margin:0;font-size:13px;color:#555;line-height:1.7;">
                        Please visit or contact the <strong>Mabayuan Barangay Office</strong> for assistance,
                        or send an email to
                        <a href="mailto:${process.env.BREVO_FROM || process.env.BREVO_USER}" style="color:#8b2131;">${process.env.BREVO_FROM || process.env.BREVO_USER}</a>
                        if you believe this was a mistake.
                      </p>
                    </div>
                    <p style="margin:0;font-size:13px;color:#aaa;text-align:center;">
                      If you did not register for this account, please ignore this email.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="background:#fdf6f7;border-top:1px solid #f0e4e5;padding:18px 32px;text-align:center;">
                    <p style="margin:0;font-size:12px;color:#aaa;">
                      © ${new Date().getFullYear()} Mabayuan Express · Barangay Document Request Portal
                    </p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body>
        </html>`
    });
    console.log(`✅ Declined email sent to ${email}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send declined email to ${email}:`, err.message);
    return false;
  }
}

/**
 * Send registration received email to resident
 */
async function sendRegistrationReceivedEmail({ firstName, lastName, email }) {
  const fullName = `${firstName} ${lastName}`;
  try {
    await sendBrevoEmail({
      to: email,
      subject: '📋 We Received Your Mabayuan Express Registration',
      html: `<!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
        <body style="margin:0;padding:0;background:#f5f0f1;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0f1;padding:32px 0;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(68,29,34,.10);max-width:560px;width:100%;">

                <!-- Header -->
                <tr>
                  <td style="background:#8b2131;padding:28px 32px;text-align:center;">
                    <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
                      <tr>
                        <td style="padding-right:12px;vertical-align:middle;">
                          <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="6" y="3" width="20" height="26" rx="3" fill="rgba(255,255,255,0.22)"/>
                            <path d="M20 3 L26 9 L20 9 Z" fill="rgba(255,255,255,0.18)"/>
                            <path d="M20 3 L20 9 L26 9" stroke="rgba(255,255,255,0.55)" stroke-width="1" fill="none"/>
                            <line x1="10" y1="14" x2="22" y2="14" stroke="rgba(255,255,255,0.7)" stroke-width="1.5" stroke-linecap="round"/>
                            <line x1="10" y1="18" x2="22" y2="18" stroke="rgba(255,255,255,0.7)" stroke-width="1.5" stroke-linecap="round"/>
                            <line x1="10" y1="22" x2="17" y2="22" stroke="rgba(255,255,255,0.7)" stroke-width="1.5" stroke-linecap="round"/>
                            <circle cx="26" cy="28" r="7" fill="#fff"/>
                            <polyline points="22.5,28 25,30.5 29.5,25.5" stroke="#8b2131" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                          </svg>
                        </td>
                        <td style="vertical-align:middle;text-align:left;">
                          <div style="color:#fff;font-size:18px;font-weight:700;line-height:1.2;">Mabayuan Express</div>
                          <div style="color:rgba(255,255,255,0.75);font-size:11px;letter-spacing:0.05em;">DOCUMENT REQUEST PORTAL</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Body -->
                <tr>
                  <td style="padding:36px 32px 28px;">
                    <!-- Clock icon -->
                    <div style="text-align:center;margin-bottom:24px;">
                      <div style="display:inline-block;background:#fdf4dc;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;text-align:center;">⏳</div>
                    </div>

                    <h1 style="margin:0 0 8px;font-size:22px;color:#2b1a1c;text-align:center;">Registration Received!</h1>
                    <p style="margin:0 0 24px;color:#736a6b;font-size:14px;text-align:center;">Your account is now pending review by our staff.</p>

                    <p style="margin:0 0 20px;font-size:15px;color:#2b1a1c;">Hi <strong>${fullName}</strong>,</p>

                    <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.7;">
                      Thank you for registering at <strong>Mabayuan Express</strong>! We've received your account registration
                      and valid ID. Our staff will review your submission shortly.
                    </p>

                    <!-- Status steps -->
                    <div style="background:#fdf6f7;border-radius:12px;padding:20px 24px;margin-bottom:24px;">
                      <p style="margin:0 0 14px;font-size:13px;font-weight:700;color:#8b2131;">What happens next:</p>

                      <table cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td width="32" style="vertical-align:top;padding-top:2px;">
                            <div style="width:24px;height:24px;background:#8b2131;border-radius:50%;text-align:center;line-height:24px;font-size:11px;font-weight:700;color:#fff;">1</div>
                          </td>
                          <td style="padding-left:10px;padding-bottom:12px;font-size:13px;color:#555;line-height:1.6;">
                            <strong style="color:#2b1a1c;">Staff reviews your registration</strong><br/>
                            Our staff will verify your valid ID and account details.
                          </td>
                        </tr>
                        <tr>
                          <td width="32" style="vertical-align:top;padding-top:2px;">
                            <div style="width:24px;height:24px;background:#8b2131;border-radius:50%;text-align:center;line-height:24px;font-size:11px;font-weight:700;color:#fff;">2</div>
                          </td>
                          <td style="padding-left:10px;padding-bottom:12px;font-size:13px;color:#555;line-height:1.6;">
                            <strong style="color:#2b1a1c;">You'll receive an email notification</strong><br/>
                            We'll send you an email once your account is approved or if there's an issue.
                          </td>
                        </tr>
                        <tr>
                          <td width="32" style="vertical-align:top;padding-top:2px;">
                            <div style="width:24px;height:24px;background:#8b2131;border-radius:50%;text-align:center;line-height:24px;font-size:11px;font-weight:700;color:#fff;">3</div>
                          </td>
                          <td style="padding-left:10px;font-size:13px;color:#555;line-height:1.6;">
                            <strong style="color:#2b1a1c;">Log in and request documents</strong><br/>
                            Once approved, you can request barangay documents anytime online.
                          </td>
                        </tr>
                      </table>
                    </div>

                    <p style="margin:0 0 8px;font-size:13px;color:#aaa;text-align:center;">
                      Have questions? Contact us at
                      <a href="mailto:${process.env.BREVO_FROM || process.env.BREVO_USER}" style="color:#8b2131;text-decoration:none;">${process.env.BREVO_FROM || process.env.BREVO_USER}</a>
                    </p>
                    <p style="margin:0;font-size:13px;color:#aaa;text-align:center;">
                      If you did not register for this account, please ignore this email.
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background:#fdf6f7;border-top:1px solid #f0e4e5;padding:18px 32px;text-align:center;">
                    <p style="margin:0;font-size:12px;color:#aaa;">
                      © ${new Date().getFullYear()} Mabayuan Express · Barangay Document Request Portal<br/>
                      This email was sent from <a href="mailto:${process.env.BREVO_FROM || process.env.BREVO_USER}" style="color:#8b2131;text-decoration:none;">${process.env.BREVO_FROM || process.env.BREVO_USER}</a>
                    </p>
                  </td>
                </tr>

              </table>
            </td></tr>
          </table>
        </body>
        </html>`
    });
    console.log(`✅ Registration email sent to ${email}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send registration email to ${email}:`, err.message);
    return false;
  }
}

module.exports = { sendAccountApprovedEmail, sendAccountDeclinedEmail, sendRegistrationReceivedEmail };
