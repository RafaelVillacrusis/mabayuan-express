async function loadRequest() {
  const requestId = window.location.pathname.split('/').pop();
  const res = await fetch(`/api/staff/requests/${requestId}`);
  const data = await res.json();
  const req = data.request;
  document.getElementById('residentName').textContent = req.resident_name;
  document.getElementById('residentContact').textContent = req.contact_number || req.phone_number || '-';
  document.getElementById('requestTransaction').textContent = req.transaction_no;
  document.getElementById('requestDocument').textContent = req.document_name;
  document.getElementById('requestPrice').textContent = peso(req.price_at_request);
  document.getElementById('requestSuggested').textContent = formatDate(req.suggested_release_date);
  document.getElementById('requestRelease').textContent = formatDate(req.release_date);
  document.getElementById('requestStatus').textContent = req.status;
  document.getElementById('requestPurpose').textContent = req.purpose || '-';
  document.getElementById('releaseDateInput').value = req.release_date ? new Date(req.release_date).toISOString().slice(0,10) : (req.suggested_release_date ? new Date(req.suggested_release_date).toISOString().slice(0,10) : '');
  document.getElementById('staffNotesRelease').value = req.staff_notes || '';
  document.getElementById('staffNotesClaim').value = req.staff_notes || '';
  document.getElementById('printReportLink').href = `/staff/request/${requestId}/report`;
  document.getElementById('logList').innerHTML = renderLogs(data.logs || []);
  document.getElementById('releaseForm').action = `/api/staff/requests/${requestId}/set-release`;
  document.getElementById('claimForm').action = `/api/staff/requests/${requestId}/claim`;

  // Show/hide action cards based on current request status
  const status = req.status;
  const releaseCard = document.getElementById('releaseForm').closest('.info-card');
  const claimCard = document.getElementById('claimForm').closest('.info-card');
  releaseCard.style.display = status === 'Approved' ? '' : 'none';
  claimCard.style.display = status === 'Ready for Pickup' ? '' : 'none';
}

document.addEventListener('DOMContentLoaded', async()=>{ showStatusMessage('pageMessage'); await loadRequest(); });
