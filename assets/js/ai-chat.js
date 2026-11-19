/**
 * Mabayuan Express AI Assistant — floating chatbot widget.
 * Include with <script src="/assets/js/ai-chat.js" defer></script>.
 * Talks to POST /api/ai/chat; the Gemini API key never reaches the browser.
 */
(function () {
  if (window.__mxAiChat) return;
  window.__mxAiChat = true;

  const MAX_LEN = 500;
  const CLIENT_TIMEOUT_MS = 40000;
  const STORE_KEY = 'mx_ai_chat_v1';
  const SUGGESTIONS = [
    'What are the requirements for a barangay clearance?',
    'How do I register for an account?',
    'How do I track my document request?',
    'What documents can I request online?',
  ];
  const GREETING = "Hi! I'm the Mabayuan Express Assistant. Ask me about barangay documents, requirements, fees, or how to use this system.";

  // ── Styles ──────────────────────────────────────────────────────────────────
  const css = `
  .mx-ai-fab{position:fixed;right:20px;bottom:calc(20px + env(safe-area-inset-bottom,0px));z-index:900;
    width:58px;height:58px;border-radius:50%;border:none;cursor:pointer;color:#fff;font-size:26px;
    background:linear-gradient(135deg,#8b2131,#a64d57);box-shadow:0 10px 26px rgba(68,29,34,.35);
    display:grid;place-items:center;transition:transform .2s}
  .mx-ai-fab:hover{transform:scale(1.06)}
  .mx-ai-fab:focus-visible{outline:3px solid #f4c2c8;outline-offset:3px}
  .mx-ai-panel{position:fixed;right:20px;bottom:calc(90px + env(safe-area-inset-bottom,0px));z-index:900;
    width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 120px));background:#fff;border-radius:18px;
    box-shadow:0 24px 60px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden;
    font-family:inherit;color:#252525}
  .mx-ai-panel[hidden]{display:none!important}
  .mx-ai-head{background:linear-gradient(135deg,#8b2131,#a64d57);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}
  .mx-ai-head strong{display:block;font-size:15px}
  .mx-ai-head small{opacity:.85;font-size:11.5px}
  .mx-ai-head .mx-ai-titles{flex:1;min-width:0}
  .mx-ai-iconbtn{background:rgba(255,255,255,.2);border:none;color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:14px;flex-shrink:0}
  .mx-ai-iconbtn:hover{background:rgba(255,255,255,.35)}
  .mx-ai-log{flex:1;overflow-y:auto;padding:14px;background:#f9f6f6;display:flex;flex-direction:column;gap:10px}
  .mx-ai-msg{max-width:86%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.5;word-wrap:break-word}
  .mx-ai-msg.user{align-self:flex-end;background:#a64d57;color:#fff;border-bottom-right-radius:4px;white-space:pre-wrap}
  .mx-ai-msg.bot{align-self:flex-start;background:#fff;border:1px solid #eadcdd;border-bottom-left-radius:4px}
  .mx-ai-msg.bot ul{margin:4px 0;padding-left:18px}
  .mx-ai-msg.bot p{margin:0 0 6px}.mx-ai-msg.bot p:last-child{margin:0}
  .mx-ai-msg.error{align-self:stretch;max-width:100%;background:#fef2f2;border:1px solid #fecaca;color:#b42318;font-size:13px}
  .mx-ai-typing{display:inline-flex;gap:4px;align-items:center}
  .mx-ai-typing span{width:7px;height:7px;border-radius:50%;background:#a64d57;opacity:.4;animation:mxAiDot 1.2s infinite}
  .mx-ai-typing span:nth-child(2){animation-delay:.2s}.mx-ai-typing span:nth-child(3){animation-delay:.4s}
  @keyframes mxAiDot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
  .mx-ai-chips{display:flex;flex-wrap:wrap;gap:6px}
  .mx-ai-chip{background:#fff;border:1px solid #d9c4c6;color:#8b2131;border-radius:999px;padding:6px 10px;font-size:12.5px;cursor:pointer;text-align:left}
  .mx-ai-chip:hover{background:#fdf2f3}
  .mx-ai-form{border-top:1px solid #f0e4e5;padding:10px;display:flex;flex-direction:column;gap:4px;background:#fff}
  .mx-ai-row{display:flex;gap:8px;align-items:flex-end}
  .mx-ai-input{flex:1;resize:none;border:1.5px solid #ddd2d3;border-radius:12px;padding:9px 11px;font:inherit;font-size:14px;
    max-height:110px;min-height:40px;line-height:1.4;outline:none}
  .mx-ai-input:focus{border-color:#a64d57}
  .mx-ai-send{background:#a64d57;color:#fff;border:none;border-radius:12px;padding:0 14px;height:40px;font-weight:700;cursor:pointer}
  .mx-ai-send:disabled{opacity:.5;cursor:not-allowed}
  .mx-ai-meta{display:flex;justify-content:space-between;font-size:11px;color:#8a7f80;padding:0 2px}
  .mx-ai-meta .over{color:#b42318;font-weight:700}
  @media (max-width:480px){
    .mx-ai-panel{right:8px;left:8px;width:auto;bottom:calc(84px + env(safe-area-inset-bottom,0px));height:calc(100vh - 110px)}
    .mx-ai-fab{right:14px;bottom:calc(14px + env(safe-area-inset-bottom,0px))}
    .mx-ai-input{font-size:16px}
  }`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ── Markup ──────────────────────────────────────────────────────────────────
  const fab = document.createElement('button');
  fab.className = 'mx-ai-fab';
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Open Mabayuan AI Assistant');
  fab.innerHTML = '💬';

  const panel = document.createElement('section');
  panel.className = 'mx-ai-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Mabayuan AI Assistant');
  panel.innerHTML = `
    <div class="mx-ai-head">
      <div class="mx-ai-titles"><strong>Mabayuan Assistant</strong><small>AI-powered · answers may be incomplete</small></div>
      <button type="button" class="mx-ai-iconbtn" data-act="clear" title="Clear conversation" aria-label="Clear conversation">⟲</button>
      <button type="button" class="mx-ai-iconbtn" data-act="close" title="Close" aria-label="Close">✕</button>
    </div>
    <div class="mx-ai-log" aria-live="polite"></div>
    <form class="mx-ai-form" novalidate>
      <div class="mx-ai-row">
        <textarea class="mx-ai-input" rows="1" placeholder="Type your question…" aria-label="Your question"></textarea>
        <button class="mx-ai-send" type="submit">Send</button>
      </div>
      <div class="mx-ai-meta"><span>For official concerns, visit the barangay office.</span><span class="mx-ai-count">0/${MAX_LEN}</span></div>
    </form>`;

  document.body.appendChild(panel);
  document.body.appendChild(fab);

  const log = panel.querySelector('.mx-ai-log');
  const form = panel.querySelector('.mx-ai-form');
  const input = panel.querySelector('.mx-ai-input');
  const sendBtn = panel.querySelector('.mx-ai-send');
  const counter = panel.querySelector('.mx-ai-count');

  // ── State ───────────────────────────────────────────────────────────────────
  let history = [];      // [{ role: 'user'|'model', text }]
  let busy = false;
  try { history = JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]').filter(t => t && t.text); } catch { history = []; }
  function persist() { try { sessionStorage.setItem(STORE_KEY, JSON.stringify(history.slice(-20))); } catch {} }

  // ── Rendering ───────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // Minimal safe formatting: **bold**, "- " / "* " / "1. " lists, paragraphs
  function format(text) {
    const lines = esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').split(/\n/);
    let html = '', list = null;
    for (const raw of lines) {
      const line = raw.trim();
      const m = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (m) {
        if (!list) { list = []; }
        list.push(`<li>${m[1]}</li>`);
        continue;
      }
      if (list) { html += `<ul>${list.join('')}</ul>`; list = null; }
      if (line) html += `<p>${line}</p>`;
    }
    if (list) html += `<ul>${list.join('')}</ul>`;
    return html || '<p></p>';
  }

  function addBubble(kind, text) {
    const div = document.createElement('div');
    div.className = `mx-ai-msg ${kind}`;
    if (kind === 'bot') div.innerHTML = format(text);
    else div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  function renderAll() {
    log.innerHTML = '';
    addBubble('bot', GREETING);
    if (!history.length) {
      const chips = document.createElement('div');
      chips.className = 'mx-ai-chips';
      SUGGESTIONS.forEach(q => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'mx-ai-chip'; b.textContent = q;
        b.addEventListener('click', () => { input.value = q; updateCount(); send(); });
        chips.appendChild(b);
      });
      log.appendChild(chips);
    }
    history.forEach(t => addBubble(t.role === 'user' ? 'user' : 'bot', t.text));
  }

  function showTyping() {
    const div = document.createElement('div');
    div.className = 'mx-ai-msg bot';
    div.setAttribute('aria-label', 'Assistant is typing');
    div.innerHTML = '<span class="mx-ai-typing"><span></span><span></span><span></span></span>';
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  function updateCount() {
    const n = input.value.trim().length;
    counter.textContent = `${n}/${MAX_LEN}`;
    counter.classList.toggle('over', n > MAX_LEN);
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 110) + 'px';
  }

  function setBusy(v) {
    busy = v;
    sendBtn.disabled = v;
    sendBtn.textContent = v ? '…' : 'Send';
  }

  // Report how long the browser took to render the answer (performance evaluation)
  function reportRender(logId, startedAt) {
    if (!logId) return;
    requestAnimationFrame(() => {
      const ms = Math.round(performance.now() - startedAt);
      fetch('/api/ai/metrics', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ log_id: logId, ui_render_ms: ms }),
      }).catch(() => {});
    });
  }

  // ── Send ────────────────────────────────────────────────────────────────────
  async function send() {
    if (busy) return;
    const text = input.value.replace(/\s+/g, ' ').trim();

    // Input validation before anything reaches the server
    if (!text) { addBubble('error', 'Please type a question first.'); return; }
    if (text.length < 2) { addBubble('error', 'Your question is too short. Please add more detail.'); return; }
    if (text.length > MAX_LEN) { addBubble('error', `Your question is too long. Please keep it under ${MAX_LEN} characters.`); return; }
    if (!navigator.onLine) { addBubble('error', 'You appear to be offline. Please check your internet connection and try again.'); return; }

    const chips = log.querySelector('.mx-ai-chips');
    if (chips) chips.remove();
    addBubble('user', text);
    input.value = '';
    updateCount();
    setBusy(true);
    const typing = showTyping();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: history.slice(-6) }),
        signal: controller.signal,
      });
      let data = null;
      try { data = await res.json(); } catch { /* non-JSON (e.g. proxy error page) */ }
      const receivedAt = performance.now();
      typing.remove();

      if (!res.ok || !data || !data.ok) {
        addBubble('error', (data && data.message) || 'Something went wrong. Please try again later.');
        return;
      }
      const answer = (data.answer || '').trim() || 'Sorry, I could not generate a response. Please contact the barangay office for assistance.';
      history.push({ role: 'user', text }, { role: 'model', text: answer });
      persist();
      addBubble('bot', answer);
      reportRender(data.log_id, receivedAt);
    } catch (err) {
      typing.remove();
      if (err.name === 'AbortError') addBubble('error', 'The assistant is taking too long to respond. Please try again later.');
      else addBubble('error', 'Connection error. Please check your internet connection and try again.');
    } finally {
      clearTimeout(timer);
      setBusy(false);
      input.focus();
    }
  }

  // ── Events ──────────────────────────────────────────────────────────────────
  function open() { panel.hidden = false; fab.innerHTML = '✕'; fab.setAttribute('aria-label', 'Close Mabayuan AI Assistant'); input.focus(); log.scrollTop = log.scrollHeight; }
  function close() { panel.hidden = true; fab.innerHTML = '💬'; fab.setAttribute('aria-label', 'Open Mabayuan AI Assistant'); }

  window.mxOpenAiChat = open;   // lets page buttons (e.g. "Ask the assistant") open the chat
  fab.addEventListener('click', () => (panel.hidden ? open() : close()));
  panel.querySelector('[data-act="close"]').addEventListener('click', close);
  panel.querySelector('[data-act="clear"]').addEventListener('click', () => { history = []; persist(); renderAll(); input.focus(); });
  form.addEventListener('submit', e => { e.preventDefault(); send(); });
  input.addEventListener('input', updateCount);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) close(); });

  renderAll();
})();
