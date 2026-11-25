let staffReqPg, pendingResPg;
let pendingResidentsById = new Map();
let allStaffRequests = [];
// Queue order: FIFO (oldest request first) by default, or newest first. Remembered on this device.
function readPref(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function savePref(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } }
let staffSortCol = 'created_at', staffSortDir = readPref('st_request_order', 'fifo') === 'newest' ? 'desc' : 'asc';
let staffNeedsFirst = readPref('st_needs_first', '1') === '1';   // "Approved" (needs a release date) on top
let socket;
function getFilter() { return new URLSearchParams(window.location.search).get('status') || 'all'; }
function setFilter(status) { const url = new URL(window.location.href); status === 'all' ? url.searchParams.delete('status') : url.searchParams.set('status', status); window.history.replaceState({}, '', url); }
async function loadMe() { const res = await fetch('/api/staff/me'); const me = await res.json(); document.getElementById('staffName').textContent = (me.full_name || 'Staff').split(' ')[0]; const t = document.getElementById('stToday'); if (t) t.textContent = new Date().toLocaleDateString('en-PH', { weekday:'long', month:'long', day:'numeric', year:'numeric' }); }
async function loadCounts() { const res = await fetch('/api/staff/counts'); const counts = await res.json(); const map = { all: counts.total_requests || 0, Approved: counts.approved_count || 0, 'Ready for Pickup': counts.ready_count || 0, Claimed: counts.claimed_count || 0 }; document.querySelectorAll('.filter-card[data-status]').forEach(card => { card.querySelector('.filter-value').textContent = map[card.dataset.status] || 0; card.classList.toggle('active', card.dataset.status === getFilter()); }); const pend = Number(counts.pending_residents || 0); document.getElementById('pendingResidentsCount').textContent = pend; document.getElementById('pendingResidentsCard')?.classList.toggle('st-attention', pend > 0); const hc = document.getElementById('pendingHeadCount'); if (hc) { hc.textContent = pend; hc.hidden = pend === 0; } }
async function loadRequests() {
  const res = await fetch('/api/staff/requests?status=all');
  allStaffRequests = await res.json();
  renderStaffQueue();
}

function getStaffQueueFiltered() {
  const search   = (document.getElementById('staffQueueSearch')?.value || '').trim().toLowerCase();
  const status   = document.getElementById('staffQueueStatus')?.value || 'all';
  const dateFrom = document.getElementById('staffQueueDateFrom')?.value || '';
  const dateTo   = document.getElementById('staffQueueDateTo')?.value || '';
  const cardFilter = getFilter();

  let rows = allStaffRequests.filter(row => {
    if (cardFilter !== 'all' && row.status !== cardFilter) return false;
    if (status !== 'all' && row.status !== status) return false;
    if (dateFrom || dateTo) {
      const d = (row.suggested_release_date || '').slice(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo   && d > dateTo)   return false;
    }
    const g = document.getElementById('staffQueueGender')?.value || 'all';
    if (g !== 'all' && (g === 'none' ? !!row.gender : row.gender !== g)) return false;
    if (search) {
      const hay = [row.transaction_no, row.resident_name, row.document_name, row.status].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  rows.sort((a, b) => {
    if (staffNeedsFirst) {
      const na = a.status === 'Approved', nb = b.status === 'Approved';
      if (na !== nb) return na ? -1 : 1;
    }
    let va = a[staffSortCol] ?? '', vb = b[staffSortCol] ?? '';
    va = String(va).toLowerCase(); vb = String(vb).toLowerCase();
    if (staffSortCol === 'gender') { va = genderSortKey(a.gender); vb = genderSortKey(b.gender); }
    if (va < vb) return staffSortDir === 'asc' ? -1 : 1;
    if (va > vb) return staffSortDir === 'asc' ?  1 : -1;
    // Same value: keep submission order (FIFO), reversed for "Newest first"
    const ta = String(a.created_at || ''), tb = String(b.created_at || '');
    const tie = ta < tb ? -1 : ta > tb ? 1 : (a.request_id - b.request_id);
    return staffSortCol === 'created_at' && staffSortDir === 'desc' ? -tie : tie;
  });

  return rows;
}

function syncStaffOrderControls() {
  const sel = document.getElementById('staffQueueOrder');
  if (!sel) return;
  sel.value = staffSortCol === 'created_at' ? (staffSortDir === 'asc' ? 'fifo' : 'newest') : 'custom';
  const colName = (document.querySelector(`#staffQueueTable th[data-col="${staffSortCol}"]`) || {}).textContent || staffSortCol;
  document.getElementById('staffQueueOrderNote').textContent = sel.value === 'fifo'
    ? 'First come, first served — the request waiting longest is at the top.'
    : sel.value === 'newest' ? 'Most recent requests are at the top.'
    : `Sorted by ${colName.trim()} (${staffSortDir === 'asc' ? 'ascending' : 'descending'}). Choose an order to go back.`;
  document.getElementById('staffQueueNeedsFirst').checked = staffNeedsFirst;
}

function renderStaffQueue() {
  syncStaffOrderControls();
  const rows = getStaffQueueFiltered();
  // Update sort indicators
  document.querySelectorAll('#staffQueueTable thead th[data-col]').forEach(th => {
    th.classList.toggle('sort-asc',  th.dataset.col === staffSortCol && staffSortDir === 'asc');
    th.classList.toggle('sort-desc', th.dataset.col === staffSortCol && staffSortDir === 'desc');
  });
  if (!staffReqPg) staffReqPg = createPaginator('staffRequestRows', 'staffReqPg', 10);
  staffReqPg.setRows(rows, row => `<tr>
    <td>${row.created_at ? formatDate(row.created_at) : '-'}</td>
    <td>${escapeHtml(row.resident_name)}</td>
    <td>${genderPill(row.gender)}</td>
    <td>${escapeHtml(row.document_name)}</td>
    <td>${formatDate(row.suggested_release_date)}</td>
    <td>${formatDate(row.release_date)}</td>
    <td><span class="status-pill status-${row.status.toLowerCase().replace(/[^a-z]+/g,'-')}">${escapeHtml(row.status)}</span></td>
    <td><a class="btn btn-small" href="/staff/request/${row.request_id}">Open</a></td>
  </tr>`);
}
async function loadPendingResidents() {
  const res  = await fetch('/api/staff/pending-residents');
  const rows = await res.json();
  if (!pendingResPg) pendingResPg = createPaginator('pendingResidentsRows', 'pendingResPg', 10);
  pendingResidentsById = new Map(rows.map(r => [String(r.resident_id), r]));
  pendingResPg.setRows(rows, row => `<tr>
    <td>${escapeHtml(row.last_name)}, ${escapeHtml(row.first_name)}</td>
    <td>${escapeHtml(row.email)}</td>
    <td>${escapeHtml(row.phone_number || '-')}</td>
    <td>${escapeHtml(row.address || '-')}</td>
    <td>${docStatusHtml(row)}</td>
    <td class="table-actions"><button class="btn btn-small" onclick="openReviewModal(${row.resident_id})">Review</button></td>
  </tr>`);
}


function docStatusHtml(row) {
  const id   = row.valid_id_path ? `<div>🪪 ${escapeHtml(row.valid_id_type || 'Valid ID')}</div>` : '<div style="color:#dc2626">🪪 No valid ID</div>';
  const cert = row.residency_cert_path ? '<div>📄 Certificate of Residency</div>' : '<div style="color:#dc2626">📄 No certificate</div>';
  return `<div style="font-size:12px;line-height:1.6">${id}${cert}</div>`;
}

// ── Resident registration review ───────────────────────────────────────────
const REVIEW_CHECKS = [
  { key: 'identity', label: 'Name and birth date on the ID match the details', needs: 'id' },
  { key: 'idValid', label: 'ID is clear, complete, and not expired', needs: 'id' },
  { key: 'residency', label: 'Certificate is from Barangay Mabayuan and names this applicant', needs: 'cert' },
];
const MISSING_CERT_REASON = 'Missing Barangay Certificate of Residency. Please re-register and upload your certificate.';
const MISSING_ID_REASON = 'Valid ID was not provided or could not be opened. Please re-register with a clear photo of your valid ID.';
let reviewState = null;

function docInfo(storedPath) {
  if (!storedPath) return { state: 'none' };
  if (storedPath.startsWith('missing:')) return { state: 'lost' };
  return { state: 'ok', isPdf: /\.pdf$/i.test(storedPath) };
}

function ageFrom(birth) {
  if (!birth) return null;
  const b = new Date(birth), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
  return isNaN(a) ? null : a;
}

function relDays(value) {
  const d = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  return formatDate(value);
}

function ensureReviewModal() {
  if (document.getElementById('residentReviewModal')) return;
  document.head.insertAdjacentHTML('beforeend', `<style>
    #residentReviewModal .details-card { width:min(1240px,100%); height:min(880px,94vh); max-height:none; }
    #residentReviewModal .details-body { padding:0; overflow:hidden; display:grid; grid-template-columns:340px minmax(0,1fr); }
    .rv-side { overflow-y:auto; padding:20px 22px; border-right:1px solid #f0e4e5; background:#fff; }
    .rv-person { display:flex; gap:12px; align-items:center; margin-bottom:16px; }
    .rv-avatar { width:48px; height:48px; border-radius:50%; background:#fbe9eb; color:var(--primary-dark,#8b3d46); display:grid; place-items:center; font-weight:800; font-size:17px; flex-shrink:0; }
    .rv-person strong { display:block; font-size:16px; line-height:1.3; }
    .rv-person span { font-size:12.5px; color:var(--muted); }
    .rv-dl { margin:0 0 16px; display:grid; grid-template-columns:auto minmax(0,1fr); gap:8px 12px; font-size:13.5px; }
    .rv-dl dt { color:var(--muted); font-size:12.5px; padding-top:1px; }
    .rv-dl dd { margin:0; font-weight:600; overflow-wrap:anywhere; }
    .rv-dl .rv-warn { color:#b42318; }
    .rv-h { font-size:12px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:#9a7a7d; margin:18px 0 8px; }
    .rv-docs { display:flex; flex-direction:column; gap:6px; }
    .rv-docrow { display:flex; align-items:center; gap:10px; padding:9px 11px; border:1px solid #f0e4e5; border-radius:12px; font-size:13.5px; cursor:pointer; background:#fff; text-align:left; font:inherit; width:100%; }
    .rv-docrow:hover { border-color:var(--primary); }
    .rv-docrow.active { border-color:var(--primary); background:#fdf2f3; }
    .rv-docrow .rv-st { margin-left:auto; font-size:11.5px; font-weight:800; border-radius:999px; padding:2px 8px; }
    .rv-st.ok { background:#e6f6ea; color:#16653a; } .rv-st.bad { background:#fde8e8; color:#b42318; }
    .rv-checks { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }
    .rv-checks label { display:flex; gap:10px; align-items:flex-start; padding:9px 11px; border:1px solid #f0e4e5; border-radius:12px; font-size:13.5px; line-height:1.4; cursor:pointer; background:#fff; }
    .rv-checks input { width:18px; height:18px; accent-color:var(--primary); margin:1px 0 0; flex-shrink:0; }
    .rv-checks label:has(input:checked) { background:#f3fbf5; border-color:#a3d9b1; }
    .rv-checks label.disabled { opacity:.55; cursor:not-allowed; }
    .rv-alert { margin-top:14px; background:#fef2f2; border:1px solid #fecaca; color:#8f1d16; border-radius:12px; padding:11px 13px; font-size:13px; line-height:1.5; }
    .rv-alert strong { display:block; margin-bottom:2px; }
    .rv-alert button { margin-top:8px; background:#b42318; color:#fff; border:none; border-radius:999px; padding:7px 14px; font:inherit; font-size:12.5px; font-weight:700; cursor:pointer; }

    .rv-viewer { display:flex; flex-direction:column; min-width:0; min-height:0; background:#f5f0f1; }
    .rv-tabs { display:flex; gap:4px; padding:10px 12px 0; background:#fff; border-bottom:1px solid #f0e4e5; }
    .rv-tab { border:none; background:none; font:inherit; font-size:14px; font-weight:700; color:var(--muted); padding:10px 14px; border-radius:10px 10px 0 0; cursor:pointer; border-bottom:3px solid transparent; display:flex; gap:8px; align-items:center; }
    .rv-tab[aria-selected="true"] { color:var(--primary-dark,#8b3d46); border-bottom-color:var(--primary); background:#fdf8f8; }
    .rv-tab .rv-dot { width:8px; height:8px; border-radius:50%; background:#16a34a; }
    .rv-tab .rv-dot.bad { background:#dc2626; }
    .rv-tools { display:flex; align-items:center; gap:6px; padding:8px 12px; background:#fff; border-bottom:1px solid #f0e4e5; flex-wrap:wrap; }
    .rv-tools .rv-sub { font-size:13px; color:var(--muted); margin-right:auto; }
    .rv-tools button, .rv-tools a { border:1px solid #e4d4d6; background:#fff; border-radius:9px; min-width:34px; height:32px; padding:0 10px; font:inherit; font-size:13px; font-weight:700; color:#3d2326; cursor:pointer; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:4px; }
    .rv-tools button:hover, .rv-tools a:hover { border-color:var(--primary); color:var(--primary); }
    .rv-tools [hidden] { display:none; }
    .rv-zoom { font-size:12px; color:var(--muted); min-width:44px; text-align:center; }
    .rv-stage { flex:1; min-height:0; overflow:auto; display:flex; align-items:center; justify-content:center; padding:16px; }
    .rv-stage.zoomed { align-items:flex-start; justify-content:flex-start; }
    .rv-stage img { max-width:100%; max-height:100%; object-fit:contain; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,.18); background:#fff; transition:transform .15s; cursor:zoom-in; }
    .rv-stage.zoomed img { max-width:none; max-height:none; cursor:zoom-out; }
    .rv-stage iframe { width:100%; height:100%; border:0; border-radius:8px; background:#fff; box-shadow:0 10px 30px rgba(0,0,0,.12); }
    .rv-stage.pdf { padding:12px; }
    .rv-empty { text-align:center; max-width:380px; color:#5b3a3f; }
    .rv-empty div { font-size:44px; margin-bottom:8px; }
    .rv-empty strong { display:block; font-size:16px; margin-bottom:6px; color:#2d1518; }
    .rv-empty p { margin:0; font-size:13.5px; line-height:1.55; color:var(--muted); }

    #residentReviewModal .details-foot { align-items:center; }
    .rv-progress { margin-right:auto; font-size:13px; color:var(--muted); display:flex; align-items:center; gap:8px; }
    .rv-progress b { color:var(--text); }
    #reviewApproveBtn:disabled { opacity:.45; cursor:not-allowed; }

    @media (max-width:860px) {
      #residentReviewModal .details-card { height:96vh; }
      #residentReviewModal .details-body { display:flex; flex-direction:column; overflow-y:auto; }
      .rv-side { overflow:visible; border-right:none; border-bottom:1px solid #f0e4e5; }
      .rv-viewer { min-height:62vh; }
      .rv-progress { width:100%; }
    }
  </style>`);
  document.body.insertAdjacentHTML('afterbegin', `
    <div class="details-modal" id="residentReviewModal" role="dialog" aria-modal="true" aria-labelledby="reviewTitle">
      <div class="details-card">
        <div class="details-head">
          <h2 id="reviewTitle">Review Registration</h2>
          <button class="details-close" onclick="closeReviewModal()" aria-label="Close">✕</button>
        </div>
        <div class="details-body">
          <aside class="rv-side" id="reviewSide"></aside>
          <section class="rv-viewer" aria-label="Uploaded documents">
            <div class="rv-tabs" role="tablist" id="rvTabs"></div>
            <div class="rv-tools" id="rvTools">
              <span class="rv-sub" id="rvSub"></span>
              <button type="button" data-z="out" title="Zoom out" aria-label="Zoom out">−</button>
              <span class="rv-zoom" id="rvZoom">Fit</span>
              <button type="button" data-z="in" title="Zoom in" aria-label="Zoom in">+</button>
              <button type="button" data-z="fit" title="Fit to screen">Fit</button>
              <button type="button" data-z="rotate" title="Rotate" aria-label="Rotate">↻</button>
              <a id="rvOpen" target="_blank" rel="noopener" title="Open in a new tab">Open ↗</a>
            </div>
            <div class="rv-stage" id="rvStage"></div>
          </section>
        </div>
        <div class="details-foot">
          <span class="rv-progress" id="rvProgress"></span>
          <span id="reviewError" style="display:none;color:#dc2626;font-size:13px;"></span>
          <button class="btn-delete" id="reviewDeclineBtn">Decline</button>
          <button class="btn-view" id="reviewApproveBtn">✓ Approve Account</button>
        </div>
      </div>
    </div>`);
  const modal = document.getElementById('residentReviewModal');
  modal.addEventListener('click', e => { if (e.target.id === 'residentReviewModal') closeReviewModal(); });
  document.getElementById('rvTools').addEventListener('click', e => {
    const b = e.target.closest('[data-z]');
    if (!b || !reviewState) return;
    const v = reviewState.view;
    if (b.dataset.z === 'in') v.zoom = Math.min(4, (v.zoom || 1) + 0.25);
    if (b.dataset.z === 'out') v.zoom = Math.max(0.5, (v.zoom || 1) - 0.25);
    if (b.dataset.z === 'fit') { v.zoom = 1; v.rotate = 0; }
    if (b.dataset.z === 'rotate') v.rotate = ((v.rotate || 0) + 90) % 360;
    applyView();
  });
}

function applyView() {
  const v = reviewState.view;
  const img = document.querySelector('#rvStage img');
  const stage = document.getElementById('rvStage');
  if (!img) return;
  const zoomed = v.zoom > 1;
  stage.classList.toggle('zoomed', zoomed);
  img.style.width = zoomed ? `${Math.round((stage.clientWidth - 32) * v.zoom)}px` : '';
  img.style.transform = `rotate(${v.rotate}deg)${v.zoom < 1 ? ` scale(${v.zoom})` : ''}`;
  document.getElementById('rvZoom').textContent = v.zoom === 1 ? 'Fit' : `${Math.round(v.zoom * 100)}%`;
}

function showReviewDoc(which) {
  const r = reviewState.resident;
  reviewState.active = which;
  reviewState.view = { zoom: 1, rotate: 0 };
  const isId = which === 'id';
  const path = isId ? r.valid_id_path : r.residency_cert_path;
  const info = docInfo(path);
  const url = `/api/staff/residents/${r.resident_id}/${isId ? 'id-image' : 'residency-cert'}`;
  const label = isId ? 'Valid ID' : 'Barangay Certificate of Residency';

  document.querySelectorAll('#rvTabs .rv-tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.doc === which)));
  document.querySelectorAll('.rv-docrow').forEach(t => t.classList.toggle('active', t.dataset.doc === which));
  document.getElementById('rvSub').textContent = isId ? (r.valid_id_type || 'ID type not specified') : 'Proof of residency in Barangay Mabayuan';
  const imageTools = info.state === 'ok' && !info.isPdf;
  document.querySelectorAll('#rvTools [data-z], #rvZoom').forEach(el => { el.hidden = !imageTools; });
  const open = document.getElementById('rvOpen');
  open.hidden = info.state !== 'ok';
  open.href = url;

  const stage = document.getElementById('rvStage');
  stage.className = 'rv-stage';
  if (info.state !== 'ok') {
    const lost = info.state === 'lost';
    stage.innerHTML = `<div class="rv-empty"><div>${isId ? '🪪' : '📄'}</div>
      <strong>${label} ${lost ? 'file is missing' : 'was not provided'}</strong>
      <p>${lost
        ? 'The uploaded file was lost during a server update. The resident needs to upload it again.'
        : isId ? 'This applicant did not upload a valid ID.'
               : 'This applicant registered before the certificate was required, so there is nothing to check. You can decline with the reason "Missing Barangay Certificate of Residency" so they can register again with it.'}</p></div>`;
    return;
  }
  if (info.isPdf) {
    stage.classList.add('pdf');
    stage.innerHTML = `<iframe src="${url}#toolbar=0&navpanes=0&view=FitH" title="${label}"></iframe>`;
    return;
  }
  stage.innerHTML = `<img src="${url}" alt="${label} uploaded by the applicant">`;
  const img = stage.querySelector('img');
  img.addEventListener('click', () => { reviewState.view.zoom = reviewState.view.zoom > 1 ? 1 : 2; applyView(); });
  img.addEventListener('error', () => {
    stage.innerHTML = `<div class="rv-empty"><div>⚠️</div><strong>Couldn't display this file</strong>
      <p>Try opening it in a new tab. If it still doesn't load, the resident may need to upload it again.</p></div>`;
  });
}

function updateReviewProgress() {
  const boxes = [...document.querySelectorAll('#rvChecks input')];
  const done = boxes.filter(b => b.checked).length;
  const total = REVIEW_CHECKS.length;
  const approve = document.getElementById('reviewApproveBtn');
  const blocked = reviewState.missing.length > 0;
  approve.disabled = blocked || done < total || reviewState.busy;
  approve.title = blocked ? 'A required document is missing' : done < total ? 'Tick every check first' : '';
  document.getElementById('rvProgress').innerHTML = blocked
    ? '⚠️ <span>Can\'t approve: a required document is missing.</span>'
    : done < total
      ? `☑️ <span><b>${done} of ${total}</b> checks done — tick all to approve</span>`
      : '✅ <span><b>All checks done.</b> Ready to approve.</span>';
}

function openReviewModal(residentId) {
  const r = pendingResidentsById.get(String(residentId));
  if (!r) return;
  ensureReviewModal();
  const idInfo = docInfo(r.valid_id_path), certInfo = docInfo(r.residency_cert_path);
  const missing = [];
  if (idInfo.state !== 'ok') missing.push('id');
  if (certInfo.state !== 'ok') missing.push('cert');
  reviewState = { resident: r, missing, busy: false, view: { zoom: 1, rotate: 0 } };

  const fullName = [r.first_name, r.middle_name, r.last_name, r.suffix].filter(Boolean).join(' ');
  const initials = ((r.first_name || '')[0] || '') + ((r.last_name || '')[0] || '');
  const age = ageFrom(r.birth_date);
  document.getElementById('reviewTitle').textContent = `Review Registration — ${fullName}`;

  const docRow = (key, label) => {
    const ok = !missing.includes(key);
    return `<button type="button" class="rv-docrow" data-doc="${key}">${key === 'id' ? '🪪' : '📄'} ${label}<span class="rv-st ${ok ? 'ok' : 'bad'}">${ok ? 'Uploaded' : 'Missing'}</span></button>`;
  };
  const checks = REVIEW_CHECKS.map(c => {
    const off = missing.includes(c.needs);
    return `<li><label class="${off ? 'disabled' : ''}"><input type="checkbox" data-check="${c.key}" ${off ? 'disabled' : ''}><span>${c.label}</span></label></li>`;
  }).join('');
  const reason = missing.includes('id') ? MISSING_ID_REASON : MISSING_CERT_REASON;

  document.getElementById('reviewSide').innerHTML = `
    <div class="rv-person"><div class="rv-avatar">${escapeHtml(initials.toUpperCase() || '?')}</div>
      <div><strong>${escapeHtml(fullName)}</strong><span>Registered ${(() => { const rel = relDays(r.created_at), abs = formatDate(r.created_at); return escapeHtml(rel === abs ? abs : `${rel} · ${abs}`); })()}</span></div></div>
    <dl class="rv-dl">
      <dt>Birth date</dt><dd>${r.birth_date ? escapeHtml(formatDate(r.birth_date)) : '—'}${age != null ? ` <span style="color:var(--muted);font-weight:500">· ${age} yrs old</span>` : ''}</dd>
      <dt>Gender</dt><dd>${escapeHtml(r.gender || 'Not specified')}</dd>
      <dt>Email</dt><dd>${escapeHtml(r.email || '—')}</dd>
      <dt>Mobile</dt><dd>${escapeHtml(r.phone_number || '—')}</dd>
      <dt>Address</dt><dd>${escapeHtml(r.address || '—')}</dd>
      <dt>ID type</dt><dd class="${r.valid_id_type ? '' : 'rv-warn'}">${escapeHtml(r.valid_id_type || 'Not specified')}</dd>
    </dl>
    <div class="rv-h">Documents</div>
    <div class="rv-docs">${docRow('id', 'Valid ID')}${docRow('cert', 'Certificate of Residency')}</div>
    <div class="rv-h">Verification checklist</div>
    <ul class="rv-checks" id="rvChecks">${checks}</ul>
    ${missing.length ? `<div class="rv-alert"><strong>${missing.includes('id') ? 'Valid ID' : 'Certificate of Residency'} is missing</strong>
      This account can't be approved without it. Decline it so the applicant can register again with the required document.
      <br><button type="button" id="rvDeclineMissing">Decline: missing document</button></div>` : ''}`;

  document.getElementById('rvTabs').innerHTML = [['id', '🪪 Valid ID'], ['cert', '📄 Certificate of Residency']].map(([k, l]) =>
    `<button type="button" class="rv-tab" role="tab" data-doc="${k}">${l}<span class="rv-dot ${missing.includes(k) ? 'bad' : ''}"></span></button>`).join('');
  document.querySelectorAll('#rvTabs .rv-tab, .rv-docrow').forEach(b => b.addEventListener('click', () => showReviewDoc(b.dataset.doc)));
  document.querySelectorAll('#rvChecks input').forEach(c => c.addEventListener('change', updateReviewProgress));
  document.getElementById('rvDeclineMissing')?.addEventListener('click', () => { closeReviewModal(); showDeclineModal(residentId, reason); });

  document.getElementById('reviewError').style.display = 'none';
  const approveBtn = document.getElementById('reviewApproveBtn');
  approveBtn.textContent = '✓ Approve Account';
  approveBtn.onclick = () => approveResident(residentId);
  document.getElementById('reviewDeclineBtn').onclick = () => { closeReviewModal(); showDeclineModal(residentId, missing.length ? reason : ''); };

  showReviewDoc(missing.includes('id') && !missing.includes('cert') ? 'cert' : 'id');
  updateReviewProgress();
  document.getElementById('residentReviewModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeReviewModal() {
  const modal = document.getElementById('residentReviewModal');
  if (modal) modal.classList.remove('open');
  document.body.style.overflow = '';
}
window.openReviewModal = openReviewModal; window.closeReviewModal = closeReviewModal;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeReviewModal(); });

async function approveResident(id) {
  const btn = document.getElementById('reviewApproveBtn');
  const errEl = document.getElementById('reviewError');
  if (btn) { btn.disabled = true; btn.textContent = 'Approving…'; }
  const res = await fetch(`/api/staff/residents/${id}/approve`, { method:'POST' });
  if (!res.ok) {
    if (btn) { btn.disabled = false; btn.textContent = '✓ Approve Account'; }
    if (errEl) { errEl.textContent = 'Could not approve resident. Please try again.'; errEl.style.display = 'inline'; }
    return;
  }
  closeReviewModal();
  await refreshAll();
}
async function declineResident(id) {
  // Show decline reason modal
  showDeclineModal(id);
}

function showDeclineModal(residentId, presetReason = '') {
  // Inject modal if not exists
  if (!document.getElementById('declineReasonModal')) {
    document.body.insertAdjacentHTML('afterbegin', `
    <div class="details-modal" id="declineReasonModal">
      <div class="details-card" style="max-width:460px;">
        <div class="details-head" style="background:linear-gradient(135deg,#8b1a22,#b03040);">
          <h2>Decline Account</h2>
          <button class="details-close" onclick="closeDeclineModal()">✕</button>
        </div>
        <div class="details-body" style="padding:22px 24px;">
          <p style="margin:0 0 16px;font-size:14px;color:#2d1518;">Please select a reason for declining this account registration:</p>
          <div style="margin-bottom:14px;">
            <label class="form-label">Reason</label>
            <select class="select" id="declineReasonSelect" onchange="handleDeclineReasonChange()">
              <option value="">Select a reason...</option>
              <option value="Invalid or unclear valid ID submitted.">Invalid or unclear valid ID</option>
              <option value="Valid ID does not match the provided personal information.">ID does not match personal information</option>
              <option value="Submitted ID has expired.">Expired ID</option>
              <option value="Incomplete personal information provided.">Incomplete personal information</option>
              <option value="Applicant is not a registered resident of Barangay Mabayuan.">Not a registered resident of Barangay Mabayuan</option>
              <option value="Duplicate account detected.">Duplicate account detected</option>
              <option value="${MISSING_CERT_REASON}">Missing Barangay Certificate of Residency</option>
              <option value="${MISSING_ID_REASON}">Missing or unreadable valid ID</option>
              <option value="others">Others (custom reason)</option>
            </select>
          </div>
          <div id="declineCustomWrap" style="display:none;margin-bottom:8px;">
            <label class="form-label">Custom Reason</label>
            <textarea class="input textarea" id="declineCustomReason" rows="3" placeholder="Type your reason here..." style="resize:vertical;min-height:80px;"></textarea>
          </div>
          <div id="declineReasonError" style="display:none;color:#dc2626;font-size:12px;margin-top:4px;"></div>
        </div>
        <div class="details-foot" style="justify-content:flex-end;">
          <button class="btn-delete" style="border-radius:10px;padding:11px 20px;" onclick="closeDeclineModal()">Cancel</button>
          <button class="btn-view" style="background:#8b1a22;border-radius:10px;padding:11px 20px;" onclick="submitDecline()">Confirm Decline</button>
        </div>
      </div>
    </div>`);
  }
  document.getElementById('declineReasonModal')._residentId = residentId;
  document.getElementById('declineReasonSelect').value = presetReason || '';
  document.getElementById('declineCustomWrap').style.display = 'none';
  document.getElementById('declineCustomReason').value = '';
  document.getElementById('declineReasonError').style.display = 'none';
  document.getElementById('declineReasonModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function handleDeclineReasonChange() {
  const sel = document.getElementById('declineReasonSelect').value;
  document.getElementById('declineCustomWrap').style.display = sel === 'others' ? 'block' : 'none';
}

function closeDeclineModal() {
  document.getElementById('declineReasonModal').classList.remove('open');
  document.body.style.overflow = '';
}

async function submitDecline() {
  const modal = document.getElementById('declineReasonModal');
  const residentId = modal._residentId;
  const sel = document.getElementById('declineReasonSelect').value;
  const custom = document.getElementById('declineCustomReason').value.trim();
  const errorEl = document.getElementById('declineReasonError');

  if (!sel) {
    errorEl.textContent = 'Please select a reason.';
    errorEl.style.display = 'block';
    return;
  }
  if (sel === 'others' && !custom) {
    errorEl.textContent = 'Please enter a custom reason.';
    errorEl.style.display = 'block';
    return;
  }

  const reason = sel === 'others' ? custom : sel;
  errorEl.style.display = 'none';

  const res = await fetch(`/api/staff/residents/${residentId}/decline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason })
  });

  closeDeclineModal();
  if (!res.ok) alert('Could not decline resident.');
  await refreshAll();
}
window.approveResident = approveResident; window.declineResident = declineResident;
async function refreshAll(){ await loadCounts(); await loadPendingResidents(); await loadRequests(); }
async function loadInboxBadge() {
  const res = await fetch('/api/staff/inbox');
  const msgs = await res.json();
  const lastSeen = parseInt(localStorage.getItem('staff_inbox_last_seen') || '0', 10);
  const unread = msgs.filter(m => m.message_id > lastSeen).length;
  const badge = document.getElementById('inboxBadge');
  const bellCount = document.getElementById('staffNotifCount');
  if (badge) { badge.textContent = unread; badge.style.display = unread > 0 ? '' : 'none'; }
  if (window.stSetInboxBadge) window.stSetInboxBadge(unread);
  if (bellCount) { bellCount.textContent = unread; bellCount.style.display = unread > 0 ? '' : 'none'; }
  return msgs;
}

function renderNotifDropdown(msgs) {
  const lastSeen = parseInt(localStorage.getItem('staff_inbox_last_seen') || '0', 10);
  const el = document.getElementById('staffNotifList');
  if (!el) return;
  el.innerHTML = msgs.length
    ? msgs.slice(0, 10).map(m => `
      <div class="notif-item ${m.message_id > lastSeen ? 'unread' : ''}">
        <strong>${escapeHtml(m.subject)}</strong>
        <p>${escapeHtml(m.body.length > 100 ? m.body.slice(0, 100) + '…' : m.body)}</p>
        <span>${formatDateTime(m.created_at)}</span>
      </div>`).join('') +
      `<div style="padding:10px 14px;text-align:center"><a href="/staff/inbox" class="btn btn-small btn-outline">View all messages</a></div>`
    : '<p style="padding:14px;color:var(--muted);font-size:.85rem">No messages yet.</p>';
}

function connectSocket() { if (socket) return; socket = io(); socket.emit('join:role', 'staff'); socket.on('dashboard:refresh', refreshAll); socket.on('notification:new', async (payload) => { if (payload && payload.from_captain) { showCaptainNotification(payload); const msgs = await loadInboxBadge(); renderNotifDropdown(msgs); } }); }

function showCaptainNotification(payload) {
  // Create or reuse a banner element
  let banner = document.getElementById('captainMsgBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'captainMsgBanner';
    banner.style.cssText = 'position:fixed;top:64px;right:16px;z-index:9999;max-width:360px;background:#fff;border:1px solid #8b5cf6;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.12);padding:16px 20px;animation:slideIn .25s ease;';
    document.body.appendChild(banner);
    const style = document.createElement('style');
    style.textContent = '@keyframes slideIn{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:translateY(0)}}';
    document.head.appendChild(style);
  }
  banner.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:start;gap:8px"><div><div style="font-weight:700;font-size:.9rem;color:#6d28d9;margin-bottom:4px">${escapeHtml(payload.title)}</div><div style="font-size:.85rem;color:#374151;white-space:pre-wrap">${escapeHtml(payload.message)}</div><div style="font-size:.75rem;color:#9ca3af;margin-top:6px">${formatDateTime(payload.created_at)}</div></div><button onclick="document.getElementById('captainMsgBanner').remove()" style="background:none;border:none;font-size:1.1rem;cursor:pointer;color:#9ca3af;padding:0;line-height:1">×</button></div>`;
  clearTimeout(banner._timeout);
  banner._timeout = setTimeout(() => { if (banner.parentNode) banner.remove(); }, 12000);
}
document.addEventListener('DOMContentLoaded', async () => {
  // "Residents to Verify" card jumps to the pending list
  const pendCard = document.getElementById('pendingResidentsCard');
  const goPending = () => document.getElementById('pendingResidentsSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  pendCard?.addEventListener('click', goPending);
  pendCard?.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goPending(); } });
  await loadMe();
  await refreshAll();
  connectSocket();
  const msgs = await loadInboxBadge();
  renderNotifDropdown(msgs);
  document.querySelectorAll('.filter-card[data-status]').forEach(card => card.addEventListener('click', async () => {
    setFilter(card.dataset.status);
    await loadCounts();
    renderStaffQueue();
  }));

  // Queue filter controls
  let qTimer;
  document.getElementById('staffQueueSearch')?.addEventListener('input', () => {
    clearTimeout(qTimer); qTimer = setTimeout(renderStaffQueue, 250);
  });
  document.getElementById('staffQueueStatus')?.addEventListener('change', renderStaffQueue);
  document.getElementById('staffQueueGender')?.addEventListener('change', renderStaffQueue);
  document.getElementById('staffQueueApply')?.addEventListener('click', renderStaffQueue);
  document.getElementById('staffQueueReset')?.addEventListener('click', () => {
    document.getElementById('staffQueueSearch').value  = '';
    document.getElementById('staffQueueStatus').value  = 'all';
    document.getElementById('staffQueueDateFrom').value = '';
    document.getElementById('staffQueueDateTo').value   = '';
    document.getElementById('staffQueueGender').value   = 'all';
    setFilter('all');
    document.querySelectorAll('.filter-card[data-status]').forEach(c =>
      c.classList.toggle('active', c.dataset.status === 'all'));
    renderStaffQueue();
  });

  // Sort headers
  document.querySelectorAll('#staffQueueTable thead th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (staffSortCol === col) staffSortDir = staffSortDir === 'asc' ? 'desc' : 'asc';
      else { staffSortCol = col; staffSortDir = 'asc'; }
      if (col === 'created_at') savePref('st_request_order', staffSortDir === 'asc' ? 'fifo' : 'newest');
      renderStaffQueue();
    });
  });

  // Order: FIFO / newest first
  document.getElementById('staffQueueOrder')?.addEventListener('change', e => {
    if (e.target.value === 'custom') return;
    staffSortCol = 'created_at';
    staffSortDir = e.target.value === 'newest' ? 'desc' : 'asc';
    savePref('st_request_order', e.target.value);
    renderStaffQueue();
  });
  document.getElementById('staffQueueNeedsFirst')?.addEventListener('change', e => {
    staffNeedsFirst = e.target.checked;
    savePref('st_needs_first', staffNeedsFirst ? '1' : '0');
    renderStaffQueue();
  });
  const bellBtn = document.getElementById('staffNotifButton');
  const dropdown = document.getElementById('staffNotifDropdown');
  if (bellBtn && dropdown) {
    bellBtn.addEventListener('click', async () => {
      dropdown.classList.toggle('show');
      if (dropdown.classList.contains('show')) {
        const latest = await loadInboxBadge();
        renderNotifDropdown(latest);
      }
    });
  }
});
