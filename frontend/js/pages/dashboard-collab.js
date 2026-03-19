/**
 * Collaborator Dashboard
 * Shows assigned events and their sections with status.
 */
(async function () {
  await App.init();

  const eventSelect = document.getElementById('eventSelect');
  const container = document.getElementById('sectionsContainer');

  // Load events
  let events = [];
  try {
    events = await Api.get('/api/events');
  } catch (e) {
    container.innerHTML = `<div class="msg msg-error">${escapeHtml(e.message)}</div>`;
    return;
  }

  if (events.length === 0) {
    eventSelect.innerHTML = '<option value="">No events</option>';
    return;
  }

  // Populate event selector
  eventSelect.innerHTML = events
    .filter(e => e.isActive)
    .map(e => `<option value="${e.id}">${escapeHtml(e.title)} — ${escapeHtml(e.countryName)}</option>`)
    .join('');

  // Load sections for selected event
  async function loadSections(eventId) {
    if (!eventId) {
      container.innerHTML = '<div class="empty-state"><p>Select an event</p></div>';
      return;
    }

    try {
      const grid = await Api.get(`/api/workflow/status-grid?event_id=${eventId}`);
      if (!grid.sections || grid.sections.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No sections for this event</p></div>';
        return;
      }

      container.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th data-i18n="dashboard.sections">Section</th>
                <th data-i18n="dashboard.status">Status</th>
                <th data-i18n="dashboard.lastUpdated">Last Updated</th>
                <th data-i18n="dashboard.actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${grid.sections.map((s, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td>${escapeHtml(s.sectionLabel)}</td>
                  <td><span class="${statusClass(s.status)}">${statusLabel(s.status)}</span></td>
                  <td>${formatDateTime(s.lastUpdatedAt)}</td>
                  <td>
                    <button class="action-btn" title="Open editor" onclick="window.location.href='/pages/editor.html?event_id=${eventId}&section_id=${s.sectionId}'">
                      <span class="icon" style="--icon-url: url(/assets/edit-icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url);"></span>
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (e) {
      container.innerHTML = `<div class="msg msg-error">${escapeHtml(e.message)}</div>`;
    }
  }

  eventSelect.addEventListener('change', () => loadSections(eventSelect.value));

  // Load first event
  if (eventSelect.value) {
    loadSections(eventSelect.value);
  }
})();
