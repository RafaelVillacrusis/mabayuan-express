document.addEventListener('DOMContentLoaded', async () => {
  const select = document.getElementById('documentSelect');
  const priceField = document.getElementById('documentPrice');
  const processingField = document.getElementById('processingDays');
  const suggestedField = document.getElementById('suggestedRelease');

  const res = await fetch('/api/public/documents');
  const docs = await res.json();
  select.innerHTML += docs.map(doc => `<option value="${doc.document_id}" data-price="${doc.price}" data-days="${doc.processing_days}">${doc.document_name}</option>`).join('');

  function updateDocInfo() {
    const opt = select.selectedOptions[0];
    if (!opt || !opt.value) {
      priceField.value = '';
      processingField.value = '';
      suggestedField.value = '';
      return;
    }
    const price = Number(opt.dataset.price || 0);
    const days = Number(opt.dataset.days || 0);
    const date = new Date();
    date.setDate(date.getDate() + days);
    priceField.value = peso(price);
    processingField.value = `${days} day(s)`;
    suggestedField.value = date.toISOString().slice(0, 10);
  }

  select.addEventListener('change', updateDocInfo);
});
