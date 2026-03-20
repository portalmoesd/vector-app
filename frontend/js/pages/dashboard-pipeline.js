/**
 * Shared pipeline dashboard for Super-Collaborator, Supervisor, and Deputy roles.
 * Shows assigned events, sections with status and progress bar,
 * and micro-action buttons based on the user's role capabilities.
 */
(async function () {
  await App.init();

  const user = Api.getUser();
  if (!user) return;

  const eventSelect = document.getElementById('eventSelect');
  const container = document.getElementById('sectionsContainer');

  // Role capabilities
  const CAN_EDIT = ['COLLABORATOR', 'SUPER_COLLABORATOR'];
  const CAN_SUBMIT = ['COLLABORATOR', 'SUPER_COLLABORATOR', 'SUPERVISOR', 'DEPUTY', 'CURATOR'];
  const CAN_APPROVE = ['SUPER_COLLABORATOR', 'SUPERVISOR', 'DEPUTY', 'CURATOR'];
  const CAN_RETURN = ['SUPER_COLLABORATOR', 'SUPERVISOR', 'DEPUTY', 'CURATOR'];

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
    return;
  }

  eventSelect.innerHTML = activeEvents
    .map(e => `<option value="${e.id}">${escapeHtml(e.title)} — ${escapeHtml(e.countryName)}</option>`)
    .join('');

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

      // Determine user's effective role in this event context
      const effectiveRole = getEffectiveRole(user, grid);

      container.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Section</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Last Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${grid.sections.map((s, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td>${escapeHtml(s.sectionLabel)}</td>
                  <td><span class="${statusClass(s.status)}">${statusLabel(s.status)}</span></td>
                  <td>${renderProgressBar(s, grid)}</td>
                  <td>${formatDateTime(s.lastUpdatedAt)}</td>
                  <td class="action-cell">
                    ${renderActions(s, eventId, effectiveRole, grid)}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;

      // Bind action buttons
      bindActions(eventId, grid);
    } catch (e) {
      container.innerHTML = `<div class="msg msg-error">${escapeHtml(e.message)}</div>`;
    }
  }

  function getEffectiveRole(user, grid) {
    // Deputy acting as Curator
    if (user.role === 'DEPUTY' && grid.deputyId === user.id && grid.documentSubmitterId !== user.id) {
      return 'CURATOR';
    }
    return user.role;
  }

  function renderProgressBar(section, grid) {
    if (!section.chain || section.chain.length === 0) return '';
    const steps = section.steps || [];
    const currentStatus = section.status || 'draft';

    return `<div class="progress-bar">${steps.map((step, idx) => {
      const stepState = getStepState(step.role, currentStatus, section);
      const name = step.actorName || roleLabel(step.role);
      return `<div class="progress-step ${stepState}" title="${escapeHtml(name)}">
        <span class="step-dot"></span>
        <span class="step-label">${escapeHtml(name)}</span>
      </div>`;
    }).join('<span class="step-arrow">→</span>')}</div>`;
  }

  function getStepState(role, status, section) {
    const chain = section.chain || [];
    const roleIdx = chain.indexOf(role);
    if (roleIdx === -1) return 'todo';

    // Check if this step is done, active, or todo
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

  function renderActions(section, eventId, effectiveRole, grid) {
    const holder = section.currentHolderRole;
    const isHolder = effectiveRole === holder;
    const btns = [];

    // Open editor (always available)
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

      // Approve (if submitted to this role)
      if (status === `submitted_to_${effectiveRole.toLowerCase()}`) {
        btns.push(`<button class="action-btn action-approve" title="Approve" data-action="approve" data-event="${eventId}" data-section="${section.sectionId}">
          <span class="icon" style="--icon-url: url(/assets/approve-icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url);"></span>
        </button>`);
        btns.push(`<button class="action-btn action-return" title="Return" data-action="return" data-event="${eventId}" data-section="${section.sectionId}">
          <span class="icon" style="--icon-url: url(/assets/return-icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url);"></span>
        </button>`);
      }
    } else if (!isHolder && section.status !== 'draft') {
      // Ask to return (if section is not at user's stage and workflow has started)
      btns.push(`<button class="action-btn action-ask-return" title="Ask to Return" data-action="ask-to-return" data-event="${eventId}" data-section="${section.sectionId}">
        <span class="icon" style="--icon-url: url(/assets/ask_to_return_icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url);"></span>
      </button>`);
    }

    return btns.join('');
  }

  function bindActions(eventId, grid) {
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const action = btn.dataset.action;
        const sectionId = parseInt(btn.dataset.section);
        const evId = parseInt(btn.dataset.event);

        try {
          if (action === 'submit') {
            await Api.post('/api/workflow/submit', { eventId: evId, sectionId });
          } else if (action === 'approve') {
            const comment = prompt('Optional comment:');
            await Api.post('/api/workflow/approve', { eventId: evId, sectionId, comment: comment || undefined });
          } else if (action === 'return') {
            const comment = prompt('Return comment (required):');
            if (!comment) return;
            await Api.post('/api/workflow/return', { eventId: evId, sectionId, comment });
          } else if (action === 'ask-to-return') {
            const note = prompt('Reason for return request:');
            if (!note) return;
            await Api.post('/api/workflow/ask-to-return', { eventId: evId, sectionId, note });
          }
          // Reload sections
          loadSections(evId);
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  eventSelect.addEventListener('change', () => loadSections(eventSelect.value));
  if (eventSelect.value) loadSections(eventSelect.value);
})();
