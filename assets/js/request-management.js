function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

async function loadRequest() {
  const requestId = window.location.pathname.split("/").pop();
  const res = await fetch(`/api/admin/requests/${requestId}`);
  const data = await res.json();

  document.getElementById("residentName").textContent = data.resident_name;
  document.getElementById("residentAddress").textContent = data.address || "-";
  document.getElementById("residentContact").textContent = data.contact_number || "-";
  document.getElementById("requestTransaction").textContent = data.transaction_no || "-";
  document.getElementById("requestDocument").textContent = data.document_type;
  document.getElementById("requestDate").textContent = formatDate(data.created_at);
  document.getElementById("requestStatus").textContent = data.status;
  document.getElementById("requestPurpose").textContent = data.purpose || "-";
  document.getElementById("validIdLink").href = data.valid_id_path || "#";
  document.getElementById("validIdPreview").src = data.valid_id_path || "";
  document.getElementById("statusSelect").value = data.status;
  document.getElementById("releaseDate").value = data.release_date ? data.release_date.split("T")[0] : "";
  document.getElementById("adminNotes").value = data.admin_notes || "";

  if (!data.valid_id_path) {
    document.getElementById("validIdLink").classList.add("disabled");
    document.getElementById("validIdLink").removeAttribute("href");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  showStatusMessage("pageMessage");
  await loadRequest();

  const previewModal = document.getElementById("previewModal");
  document.getElementById("openPreview").addEventListener("click", () => previewModal.classList.add("is-open"));
  document.getElementById("closePreview").addEventListener("click", () => previewModal.classList.remove("is-open"));
  previewModal.addEventListener("click", (event) => {
    if (event.target === previewModal) previewModal.classList.remove("is-open");
  });
});
