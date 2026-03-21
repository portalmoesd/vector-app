/**
 * Collaborator Dashboard
 * Shows assigned events and their sections with status, progress bar,
 * submit, and ask-to-return capabilities.
 */
(async function () {
  await App.init();

  const user = Api.getUser();
  if (!user) return;

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

  const activeEvents = events.filter(e => e.isActive);
  if (activeEvents.length === 0) {
    eventSelect.innerHTML = '<option value="">No events</option>';
    container.innerHTML = '<div class="empty-state"><p>No active events assigned to you</p></div>';
    return;
  }

  // Populate event selector
  eventSelect.innerHTML = activeEvents
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
      // Filter sections: Deputies see all sections.
      // Other users see sections assigned to their department,
      // OR sections where they have a RECEIVING_ role in the approval chain
      // (i.e. they belong to the DS home department reviewing cross-dept sections).
      const mySections = user.role === 'DEPUTY'
        ? (grid.sections || [])
        : (grid.sections || []).filter(s =>
            (s.departmentIds && s.departmentIds.includes(user.departmentId)) ||
            (s.userEffectiveRole && s.userEffectiveRole.startsWith('RECEIVING_') && s.chain && s.chain.includes(s.userEffectiveRole))
          );

      if (mySections.length === 0) {
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
                <th>Progress</th>
                <th data-i18n="dashboard.lastUpdated">Last Updated</th>
                <th data-i18n="dashboard.actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${mySections.map((s, i) => {
                const notices = [];
                if (s.returnInfo) {
                  notices.push(`<div class="dp-return-notice dp-return-notice--returned">Returned by ${escapeHtml(s.returnInfo.from || s.returnInfo.fromRole)}${s.returnInfo.note ? ': ' + escapeHtml(s.returnInfo.note) : ''}</div>`);
                }
                if (s.returnRequest) {
                  notices.push(`<div class="dp-return-notice">Return requested by ${escapeHtml(s.returnRequest.from)}${s.returnRequest.note ? ': ' + escapeHtml(s.returnRequest.note) : ''}</div>`);
                }
                return `
                <tr>
                  <td>${i + 1}</td>
                  <td>${escapeHtml(s.sectionLabel)}${notices.length ? notices.join('') : ''}</td>
                  <td><span class="${statusClass(s.status)}">${statusLabel(s.status)}</span></td>
                  <td>${renderProgressBar(s, grid)}</td>
                  <td>${formatDateTime(s.lastUpdatedAt)}</td>
                  <td class="action-cell">
                    ${renderActions(s, eventId, grid)}
                  </td>
                </tr>
              `}).join('')}
            </tbody>
          </table>
        </div>
      `;

      // Bind action buttons
      bindActions(eventId);
    } catch (e) {
      container.innerHTML = `<div class="msg msg-error">${escapeHtml(e.message)}</div>`;
    }
  }

  function renderProgressBar(section, grid) {
    const steps = section.steps || [];
    if (steps.length === 0) return '';
    const status = section.status || 'draft';

    return `<div class="progress-bar">${steps.map((step) => {
      const state = getStepState(step.role, status, section);
      const name = step.actorName || roleLabel(step.role);
      return `<div class="progress-step ${state}" title="${escapeHtml(name)}">
        <span class="step-dot"></span>
        <span class="step-label">${escapeHtml(name)}</span>
      </div>`;
    }).join('<span class="step-arrow">\u2192</span>')}</div>`;
  }

  function getStepState(role, status, section) {
    const chain = section.chain || [];
    const roleIdx = chain.indexOf(role);
    if (roleIdx === -1) return 'todo';

    if (status === 'draft') {
      return roleIdx === 0 ? 'active' : 'todo';
    }
    if (status.startsWith('submitted_to_')) {
      const target = status.replace('submitted_to_', '').toUpperCase();
      const targetIdx = chain.indexOf(target);
      if (roleIdx < targetIdx) return 'done';
      if (roleIdx === targetIdx) return 'active';
      return 'todo';
    }
    if (status.startsWith('approved_by_')) {
      const approver = status.replace('approved_by_', '').toUpperCase();
      const approverIdx = chain.indexOf(approver);
      if (roleIdx <= approverIdx) return 'done';
      if (roleIdx === approverIdx + 1) return 'active';
      return 'todo';
    }
    if (status.startsWith('returned_')) {
      return roleIdx === 0 ? 'active' : 'todo';
    }
    return 'todo';
  }

  function renderActions(section, eventId, grid) {
    const holder = section.currentHolderRole;
    const effRole = section.userEffectiveRole || user.role;
    const isHolder = effRole === holder;
    const btns = [];

    // Open editor (always)
    btns.push(`<button class="action-btn" title="Open" onclick="window.location.href='/pages/editor.html?event_id=${eventId}&section_id=${section.sectionId}'">
      <span class="icon" style="--icon-url: url(/assets/edit-icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url);"></span>
    </button>`);

    if (isHolder) {
      const status = section.status || 'draft';

      // Submit (if at draft or returned status)
      if (status === 'draft' || status.startsWith('returned_')) {
        btns.push(`<button class="action-btn action-submit" title="Submit" data-action="submit" data-event="${eventId}" data-section="${section.sectionId}">
          <span class="icon" style="--icon-url: url(/assets/submit-icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url);"></span>
        </button>`);
      }
    } else if (!isHolder && section.status !== 'draft' && section.status) {
      // Ask to return: only if user is in the chain and section has passed their step
      const chain = section.chain || [];
      const userIdx = chain.indexOf(effRole);
      const holderIdx = chain.indexOf(holder);
      if (userIdx !== -1 && holderIdx > userIdx) {
        btns.push(`<button class="action-btn action-ask-return" title="Ask to Return" data-action="ask-to-return" data-event="${eventId}" data-section="${section.sectionId}">
          <span class="icon" style="--icon-url: url(/assets/ask_to_return_icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url);"></span>
        </button>`);
      }
    }

    return btns.join('');
  }

  function bindActions(eventId) {
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const action = btn.dataset.action;
        const sectionId = parseInt(btn.dataset.section);
        const evId = parseInt(btn.dataset.event);

        try {
          if (action === 'submit') {
            if (!confirm('Submit this section?')) return;
            await Api.post('/api/workflow/submit', { eventId: evId, sectionId });
          } else if (action === 'ask-to-return') {
            const note = prompt('Reason for return request:');
            if (note === null) return;
            await Api.post('/api/workflow/ask-to-return', { eventId: evId, sectionId, note: note || undefined });
          }
          loadSections(evId);
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  eventSelect.addEventListener('change', () => loadSections(eventSelect.value));

  // Load first event
  if (eventSelect.value) {
    loadSections(eventSelect.value);
  }
})();
