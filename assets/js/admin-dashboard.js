let adminSocket;

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getAdminStatusFromUrl() {
  return new URLSearchParams(window.location.search).get("status") || "all";
}

function setAdminStatus(status) {
  const url = new URL(window.location.href);
  if (status === "all") url.searchParams.delete("status");
  else url.searchParams.set("status", status);
  window.history.replaceState({}, "", url);
}

async function loadAdminIdentity() {
  const res = await fetch("/api/admin/me");
  const me = await res.json();
  document.getElementById("adminName").textContent = me.full_name;
}

async function loadAdminCounts() {
  const res = await fetch("/api/admin/counts");
  const counts = await res.json();

  const mapping = {
    all: counts.total_requests || 0,
    "Pending Review": counts.pending_review || 0,
    "In Progress": counts.in_progress || 0,
    "Ready for Pickup": counts.ready_for_pickup || 0,
    Completed: counts.completed_count || 0
  };

  document.querySelectorAll(".filter-card").forEach(card => {
    card.querySelector(".filter-value").textContent = mapping[card.dataset.status] || 0;
    card.classList.toggle("active", card.dataset.status === getAdminStatusFromUrl());
  });
}

async function loadAdminRequests() {
  const status = getAdminStatusFromUrl();
  const res = await fetch(`/api/admin/requests?status=${encodeURIComponent(status)}`);
  const rows = await res.json();
  const tbody = document.getElementById("adminRequestRows");
  tbody.innerHTML = rows.map(row => `
    <tr>
      <td>${row.transaction_no || "-"}</td>
      <td>${row.resident_name}</td>
      <td>${row.document_type}</td>
      <td><span class="status-pill status-${row.status.toLowerCase().replace(/[^a-z]+/g, "-")}">${row.status}</span></td>
      <td>${formatDate(row.release_date)}</td>
      <td><a class="btn btn-small" href="/admin/request/${row.request_id}">Review</a></td>
    </tr>
  `).join("") || `<tr><td colspan="6" class="empty-state">No requests found.</td></tr>`;
}

async function loadPendingResidents() {
  const res = await fetch("/api/admin/pending-residents");
  const rows = await res.json();
  const tbody = document.getElementById("pendingResidentsRows");
  tbody.innerHTML = rows.map(row => {
    const idCell = row.valid_id_path
      ? `<a class="btn btn-small" href="${escapeHtml(row.valid_id_path)}" target="_blank" rel="noopener">View ID</a>`
      : `<span class="status-pill status-declined">No ID</span>`;

    return `
      <tr>
        <td>${row.last_name}, ${row.first_name}</td>
        <td>${row.email}</td>
        <td>${formatDate(row.created_at)}</td>
        <td>${idCell}</td>
        <td class="table-actions">
          <button class="btn btn-small" onclick="approveResident(${row.resident_id})">Approve</button>
          <button class="btn btn-small btn-ghost" onclick="declineResident(${row.resident_id})">Decline</button>
        </td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="5" class="empty-state">No pending residents.</td></tr>`;
}

async function approveResident(id) {
  await fetch(`/api/admin/residents/${id}/approve`, { method: "POST" });
  await loadPendingResidents();
  await loadAdminCounts();
}
window.approveResident = approveResident;

async function declineResident(id) {
  await fetch(`/api/admin/residents/${id}/decline`, { method: "POST" });
  await loadPendingResidents();
}
window.declineResident = declineResident;

function connectAdminSocket() {
  if (adminSocket) return;
  adminSocket = io();
  adminSocket.emit("join:admin");
  adminSocket.on("dashboard:refresh", async () => {
    await loadAdminCounts();
    await loadAdminRequests();
    await loadPendingResidents();
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadAdminIdentity();
  await loadAdminCounts();
  await loadAdminRequests();
  await loadPendingResidents();
  connectAdminSocket();

  document.querySelectorAll(".filter-card").forEach(card => {
    card.addEventListener("click", async () => {
      setAdminStatus(card.dataset.status);
      await loadAdminCounts();
      await loadAdminRequests();
    });
  });
});
