/* Resident — My Profile: contact number, and email/password changes confirmed by an emailed code */
(function () {
  const $ = id => document.getElementById(id);
  const RESEND_SECONDS = 60;
  let me = null;
  const timers = {};

  async function api(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    if (res.redirected || res.status === 401) { window.location.href = '/login'; throw new Error('Please log in again.'); }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(json.error || 'Something went wrong. Please try again.'); e.field = json.field; throw e; }
    return json;
  }
  function msg(id, text, ok) {
    const el = $(id);
    el.textContent = text || '';
    el.hidden = !text;
    el.classList.toggle('ok', !!ok);
  }
  function busy(btn, on, label) {
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label; }
    else if (btn.dataset.label) btn.textContent = btn.dataset.label;
    btn.disabled = on;
  }
  function markBad(id) {
    document.querySelectorAll('.pf-step .input.bad').forEach(i => i.classList.remove('bad'));
    if (id && $(id)) { $(id).classList.add('bad'); $(id).focus(); }
  }

  // ── Load profile ─────────────────────────────────────────────────────────
  async function load() {
    const res = await fetch('/api/resident/profile');
    if (!res.ok) return;
    me = await res.json();
    const name = [me.first_name, me.middle_name, me.last_name, me.suffix].filter(Boolean).join(' ');
    $('pfName').textContent = name || '—';
    $('pfBirth').textContent = me.birth_date ? formatDate(me.birth_date) : '—';
    $('pfGender').textContent = me.gender || 'Not specified';
    $('pfAddress').textContent = me.address || '—';
    $('pfSince').textContent = me.created_at ? formatDate(me.created_at) : '—';
    $('pfEmail').textContent = me.email || '—';
    const num = String(me.phone_number || '').replace(/\D/g, '').replace(/^63/, '').replace(/^0/, '');
    $('pfPhone').value = /^9\d{9}$/.test(num) ? num : '';

    // Resume a change that is waiting for its code (e.g. after a refresh)
    (me.pending || []).forEach(p => {
      if (p.purpose === 'email') showCodeStep('email', p.new_email, 0);
      if (p.purpose === 'password') showCodeStep('password', me.email ? me.email.replace(/^(.{2})[^@]*(@.*)$/, '$1•••$2') : 'your email', 0);
    });
  }

  // ── Contact number ───────────────────────────────────────────────────────
  $('contactForm').addEventListener('submit', async e => {
    e.preventDefault();
    msg('contactMsg', '');
    const phone = $('pfPhone');
    if (!/^9\d{9}$/.test(phone.value)) {
      phPhoneValidate(phone);
      phone.classList.add('bad');
      return msg('contactMsg', 'Enter a valid mobile number: 10 digits starting with 9 (e.g. 9171234567).');
    }
    phone.classList.remove('bad');
    const btn = $('contactSave');
    busy(btn, true, 'Saving…');
    try {
      const r = await api('/api/resident/profile/contact', { phone_number: phone.value });
      msg('contactMsg', r.unchanged ? 'That is already your contact number.' : '✓ Your contact number was updated.', true);
    } catch (err) { msg('contactMsg', err.message); }
    busy(btn, false);
  });

  // ── Shared: step switching, resend countdown ─────────────────────────────
  const FORMS = { email: ['emailForm', 'emailCodeForm', 'emailStartBtn'], password: ['pwForm', 'pwCodeForm', 'pwStartBtn'] };

  function showForm(kind) {
    const [form, code, start] = FORMS[kind];
    $(form).hidden = false; $(code).hidden = true; $(start).hidden = true;
    if (kind === 'password') $('pwDone').hidden = true;
    msg(kind === 'email' ? 'emailMsg' : 'pwMsg', '');
    $(form).querySelector('input').focus();
  }
  function closeAll(kind) {
    const [form, code, start] = FORMS[kind];
    $(form).hidden = true; $(code).hidden = true; $(start).hidden = false;
    $(form).reset(); $(code).reset();
    clearInterval(timers[kind]);
  }
  function showCodeStep(kind, sentTo, waitSeconds = RESEND_SECONDS) {
    const [form, code, start] = FORMS[kind];
    $(form).hidden = true; $(code).hidden = false; $(start).hidden = true;
    $(kind === 'email' ? 'emailSentTo' : 'pwSentTo').textContent = sentTo;
    msg(kind === 'email' ? 'emailCodeMsg' : 'pwCodeMsg', '');
    startCountdown(kind, waitSeconds);
    setTimeout(() => $(kind === 'email' ? 'emailCode' : 'pwCode').focus(), 30);
  }
  function startCountdown(kind, seconds) {
    const btn = $(kind === 'email' ? 'emailResend' : 'pwResend');
    clearInterval(timers[kind]);
    let left = seconds;
    const tick = () => {
      btn.disabled = left > 0;
      btn.textContent = left > 0 ? `Resend code in ${left}s` : 'Resend code';
      left -= 1;
      if (left < -1) clearInterval(timers[kind]);
    };
    tick();
    timers[kind] = setInterval(tick, 1000);
  }

  document.addEventListener('click', async e => {
    const cancel = e.target.closest('[data-cancel]');
    if (cancel) {
      const kind = cancel.dataset.cancel;
      const waitingForCode = !$(FORMS[kind][1]).hidden;
      closeAll(kind);
      if (waitingForCode) api(`/api/resident/profile/${kind}/cancel`).catch(() => {});
    }
    const show = e.target.closest('[data-show]');
    if (show) {
      const input = $(show.dataset.show);
      input.type = input.type === 'password' ? 'text' : 'password';
      show.textContent = input.type === 'password' ? 'Show' : 'Hide';
    }
  });
  $('emailStartBtn').addEventListener('click', () => showForm('email'));
  $('pwStartBtn').addEventListener('click', () => showForm('password'));
  // Codes: digits only
  ['emailCode', 'pwCode'].forEach(id => $(id).addEventListener('input', () => { $(id).value = $(id).value.replace(/\D/g, '').slice(0, 6); }));

  // ── Email change ─────────────────────────────────────────────────────────
  let lastEmailRequest = null;
  async function sendEmailCode(btn) {
    const new_email = $('pfNewEmail').value.trim();
    const current_password = $('pfEmailPw').value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(new_email)) { markBad('pfNewEmail'); return msg('emailMsg', 'Please enter a valid email address.'); }
    if (!current_password) { markBad('pfEmailPw'); return msg('emailMsg', 'Please enter your current password.'); }
    markBad(null);
    busy(btn, true, 'Sending…');
    try {
      const r = await api('/api/resident/profile/email/start', { new_email, current_password });
      lastEmailRequest = { new_email, current_password };
      showCodeStep('email', r.sentTo);
    } catch (err) {
      msg('emailMsg', err.message);
      markBad({ new_email: 'pfNewEmail', current_password: 'pfEmailPw' }[err.field]);
    }
    busy(btn, false);
  }
  $('emailForm').addEventListener('submit', e => { e.preventDefault(); msg('emailMsg', ''); sendEmailCode($('emailSend')); });
  $('emailResend').addEventListener('click', async () => {
    if (!lastEmailRequest) { closeAll('email'); showForm('email'); return msg('emailMsg', 'Please enter your new email again to get a fresh code.'); }
    const btn = $('emailResend');
    btn.disabled = true;
    try {
      const r = await api('/api/resident/profile/email/start', lastEmailRequest);
      msg('emailCodeMsg', `A new code was sent to ${r.sentTo}.`, true);
      startCountdown('email', RESEND_SECONDS);
    } catch (err) { msg('emailCodeMsg', err.message); btn.disabled = false; }
  });
  $('emailCodeForm').addEventListener('submit', async e => {
    e.preventDefault();
    const code = $('emailCode').value;
    if (!/^\d{6}$/.test(code)) return msg('emailCodeMsg', 'Enter the 6-digit code from the email.');
    const btn = $('emailVerify');
    busy(btn, true, 'Verifying…');
    try {
      const r = await api('/api/resident/profile/email/confirm', { code });
      closeAll('email');
      $('pfEmail').textContent = r.email;
      const menuEmail = $('rsMenuEmail');
      if (menuEmail) menuEmail.textContent = r.email;
      lastEmailRequest = null;
      const done = document.createElement('div');
      done.className = 'pf-msg ok';
      done.textContent = '✓ Your email was changed. Use it the next time you log in. We also let your old email know.';
      $('emailStartBtn').closest('.pf-card').appendChild(done);
      setTimeout(() => done.remove(), 8000);
    } catch (err) { msg('emailCodeMsg', err.message); }
    busy(btn, false);
  });

  // ── Password change ──────────────────────────────────────────────────────
  const RULES = { len: v => v.length >= 8, letter: v => /[a-zA-Z]/.test(v), num: v => /\d/.test(v), special: v => /[^a-zA-Z0-9]/.test(v) };
  $('pfNewPw').addEventListener('input', () => {
    const v = $('pfNewPw').value;
    document.querySelectorAll('#pwRules [data-rule]').forEach(li => li.classList.toggle('ok', RULES[li.dataset.rule](v)));
  });
  let lastPwRequest = null;
  $('pwForm').addEventListener('submit', async e => {
    e.preventDefault();
    msg('pwMsg', '');
    const body = { current_password: $('pfCurPw').value, new_password: $('pfNewPw').value, confirm_password: $('pfConfirmPw').value };
    if (!body.current_password) { markBad('pfCurPw'); return msg('pwMsg', 'Please enter your current password.'); }
    if (!Object.values(RULES).every(r => r(body.new_password))) { markBad('pfNewPw'); return msg('pwMsg', 'Your new password must be at least 8 characters and include a letter, a number and a special character.'); }
    if (body.new_password !== body.confirm_password) { markBad('pfConfirmPw'); return msg('pwMsg', 'The new passwords do not match.'); }
    markBad(null);
    const btn = $('pwSend');
    busy(btn, true, 'Sending…');
    try {
      const r = await api('/api/resident/profile/password/start', body);
      lastPwRequest = body;
      showCodeStep('password', r.sentTo);
    } catch (err) {
      msg('pwMsg', err.message);
      markBad({ current_password: 'pfCurPw', new_password: 'pfNewPw', confirm_password: 'pfConfirmPw' }[err.field]);
    }
    busy(btn, false);
  });
  $('pwResend').addEventListener('click', async () => {
    if (!lastPwRequest) { closeAll('password'); showForm('password'); return msg('pwMsg', 'Please enter your passwords again to get a fresh code.'); }
    const btn = $('pwResend');
    btn.disabled = true;
    try {
      const r = await api('/api/resident/profile/password/start', lastPwRequest);
      msg('pwCodeMsg', `A new code was sent to ${r.sentTo}.`, true);
      startCountdown('password', RESEND_SECONDS);
    } catch (err) { msg('pwCodeMsg', err.message); btn.disabled = false; }
  });
  $('pwCodeForm').addEventListener('submit', async e => {
    e.preventDefault();
    const code = $('pwCode').value;
    if (!/^\d{6}$/.test(code)) return msg('pwCodeMsg', 'Enter the 6-digit code from the email.');
    const btn = $('pwVerify');
    busy(btn, true, 'Verifying…');
    try {
      await api('/api/resident/profile/password/confirm', { code });
      closeAll('password');
      lastPwRequest = null;
      document.querySelectorAll('#pwRules li').forEach(li => li.classList.remove('ok'));
      msg('pwDone', '✓ Your password was changed. Use your new password the next time you log in.', true);
    } catch (err) { msg('pwCodeMsg', err.message); }
    busy(btn, false);
  });

  load();
})();
