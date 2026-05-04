async function loadRequest() {
  const requestId = window.location.pathname.split('/').pop();
  const res = await fetch(`/api/captain/requests/${requestId}`);
  const data = await res.json();
  const req = data.request;
  document.getElementById('residentName').textContent = req.resident_name;
  document.getElementById('residentAddress').textContent = req.address || '-';
  document.getElementById('residentContact').textContent = req.contact_number || req.phone_number || '-';
  document.getElementById('residentEmail').textContent = req.email || '-';
  document.getElementById('requestTransaction').textContent = req.transaction_no;
  document.getElementById('requestDocument').textContent = req.document_name;
  document.getElementById('requestPrice').textContent = peso(req.price_at_request);
  document.getElementById('requestSuggested').textContent = formatDate(req.suggested_release_date);
  document.getElementById('requestStatus').textContent = req.status;
  document.getElementById('requestPurpose').textContent = req.purpose || '-';
  document.getElementById('captainNotes').value = req.captain_notes || '';
  document.getElementById('logList').innerHTML = renderLogs(data.logs || []);
  document.getElementById('decisionForm').action = `/api/captain/requests/${requestId}/decision`;
}

document.addEventListener('DOMContentLoaded', async () => {
  showStatusMessage('pageMessage');
  await loadRequest();
});
