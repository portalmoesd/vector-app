/**
 * Shared utility functions.
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('ka-GE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleString('ka-GE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function statusLabel(status) {
  if (!status) return 'Draft';
  const map = {
    draft: 'Draft',
    submitted_to_super_collaborator: 'At Super-Collaborator',
    returned_by_super_collaborator: 'Returned by Super-Collaborator',
    approved_by_super_collaborator: 'Approved (Super-Collaborator)',
    submitted_to_curator: 'At Curator',
    returned_by_curator: 'Returned by Curator',
    approved_by_curator: 'Approved (Curator)',
    submitted_to_supervisor: 'At Supervisor',
    returned_by_supervisor: 'Returned by Supervisor',
    approved_by_supervisor: 'Approved (Supervisor)',
    submitted_to_deputy: 'At Deputy',
    returned_by_deputy: 'Returned by Deputy',
    approved_by_deputy: 'Approved (Deputy)',
    // Receiving chain (DS home department review)
    submitted_to_receiving_super_collaborator: 'At Super-Collaborator (Review)',
    returned_by_receiving_super_collaborator: 'Returned by Super-Collaborator (Review)',
    approved_by_receiving_super_collaborator: 'Approved (Super-Collaborator Review)',
    submitted_to_receiving_supervisor: 'At Supervisor (Review)',
    returned_by_receiving_supervisor: 'Returned by Supervisor (Review)',
    approved_by_receiving_supervisor: 'Approved (Supervisor Review)',
  };
  return map[status] || status;
}

function statusClass(status) {
  if (!status || status === 'draft') return 'status-draft';
  if (status.startsWith('submitted_')) return 'status-submitted';
  if (status.startsWith('returned_')) return 'status-returned';
  if (status.startsWith('approved_')) return 'status-approved';
  return '';
}

function languageLabel(code) {
  const map = {
    EN: 'English', FR: 'Français', AR: 'العربية', ES: 'Español',
    RU: 'Русский', ZH: '中文', PT: 'Português', DE: 'Deutsch', KA: 'ქართული',
  };
  return map[code] || code;
}

function roleLabel(role) {
  const map = {
    ADMIN: 'Admin',
    PROTOCOL: 'Protocol',
    DEPUTY: 'Deputy',
    SUPERVISOR: 'Supervisor',
    SUPER_COLLABORATOR: 'Super-Collaborator',
    COLLABORATOR: 'Collaborator',
    CURATOR: 'Curator',
    // Receiving chain roles display the same label — the department name
    // shown underneath distinguishes them from the section dept's roles
    RECEIVING_SUPER_COLLABORATOR: 'Super-Collaborator',
    RECEIVING_SUPERVISOR: 'Supervisor',
  };
  return map[role] || role;
}

/** Get the dashboard URL for a given role */
function dashboardUrl(role) {
  const map = {
    COLLABORATOR: '/pages/dashboard-collab.html',
    SUPER_COLLABORATOR: '/pages/dashboard-super-collab.html',
    SUPERVISOR: '/pages/dashboard-supervisor.html',
    DEPUTY: '/pages/dashboard-deputy.html',
    ADMIN: '/pages/admin.html',
    PROTOCOL: '/pages/calendar.html',
  };
  return map[role] || '/pages/dashboard-collab.html';
}
