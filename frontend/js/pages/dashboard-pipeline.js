/**
 * Shared pipeline dashboard for Super-Collaborator, Supervisor, and Deputy roles.
 * Shows assigned events, sections with visual progress pipeline,
 * and micro-action links based on the user's role capabilities.
 * Includes: mini calendar, upcoming events, section history.
 */
(async function () {
  await App.init();

  let activePopover = null;
  const user = Api.getUser();
  if (!user) return;

  const eventSelect = document.getElementById('eventSelect');
  const eventDetailsEl = document.getElementById('eventDetails');
  const sectionsCardEl = document.getElementById('sectionsCard');
  const previewBtn = document.getElementById('previewBtn');
  const miniCalendarEl = document.getElementById('miniCalendar');
  const upcomingListEl = document.getElementById('upcomingList');

  // Fallback for old HTML layout (sectionsContainer)
  const legacyContainer = document.getElementById('sectionsContainer');

  // Load events
  let events = [];
  try {
    events = await Api.get('/api/events');
  } catch (e) {
    const target = sectionsCardEl || legacyContainer;
    if (target) target.innerHTML = `<div class="msg msg-error">${escapeHtml(e.message)}</div>`;
    return;
  }

  const activeEvents = events.filter(e => e.isActive);

  if (activeEvents.length === 0) {
    eventSelect.innerHTML = '<option value="">No events</option>';
  } else {
    eventSelect.innerHTML = '<option value="">Select event...</option>' +
      activeEvents.map(e => {
        const deadline = e.deadlineDate ? formatDate(e.deadlineDate) : '';
        const label = `${e.title} (${e.countryName}${deadline ? ', ' + deadline : ''})`;
        return `<option value="${e.id}">${escapeHtml(label)}</option>`;
      }).join('');
  }

  // Preview button
  if (previewBtn) {
    previewBtn.addEventListener('click', () => {
      const eventId = eventSelect.value;
      if (eventId) {
        window.location.href = `/pages/editor-all.html?event_id=${eventId}`;
      }
    });
  }

  // ── Render upcoming events + calendar ────────────────────────────────────
  if (upcomingListEl) renderUpcomingEvents();
  if (miniCalendarEl) renderMiniCalendar(new Date());

  function renderUpcomingEvents() {
    const upcoming = activeEvents.filter(e => e.deadlineDate);
    upcoming.sort((a, b) => new Date(a.deadlineDate) - new Date(b.deadlineDate));

    if (upcoming.length === 0) {
      upcomingListEl.innerHTML = '<div class="empty-state"><p>No upcoming events</p></div>';
      return;
    }

    upcomingListEl.innerHTML = upcoming.slice(0, 5).map(e => `
      <div class="dp-upcoming-event" data-event-id="${e.id}" style="cursor:pointer;">
        <h4 class="dp-upcoming-event__title">${escapeHtml(e.title)}</h4>
        <div class="dp-upcoming-event__pills">
          <span class="dp-upcoming-event__pill">${escapeHtml(e.countryName)}</span>
          ${e.deadlineDate ? `<span class="dp-upcoming-event__pill">Deadline: ${formatDate(e.deadlineDate)}</span>` : ''}
          <span class="dp-upcoming-event__pill dp-upcoming-event__pill--lang">${e.language || 'EN'}</span>
        </div>
        ${e.occasion ? `<div class="dp-upcoming-event__desc">${e.occasion}</div>` : ''}
      </div>
    `).join('');

    upcomingListEl.querySelectorAll('[data-event-id]').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.eventId;
        eventSelect.value = id;
        loadSections(id);
      });
    });
  }

  function renderMiniCalendar(date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const today = new Date();

    const eventDates = new Set();
    activeEvents.forEach(e => {
      if (e.deadlineDate) {
        const d = new Date(e.deadlineDate);
        if (d.getFullYear() === year && d.getMonth() === month) {
          eventDates.add(d.getDate());
        }
      }
    });

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const dayNames = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

    const firstDay = new Date(year, month, 1);
    let startDay = firstDay.getDay() - 1;
    if (startDay < 0) startDay = 6;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let daysHtml = dayNames.map(d => `<span class="dp-cal-grid__day-name">${d}</span>`).join('');
    for (let i = 0; i < startDay; i++) {
      daysHtml += '<span class="dp-cal-grid__day dp-cal-grid__day--empty"></span>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
      const hasEvent = eventDates.has(d);
      let cls = 'dp-cal-grid__day';
      if (isToday) cls += ' dp-cal-grid__day--today';
      if (hasEvent) cls += ' dp-cal-grid__day--has-event';
      const dateAttr = hasEvent ? ` data-cal-date="${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}"` : '';
      daysHtml += `<span class="${cls}"${dateAttr}>${d}</span>`;
    }

    miniCalendarEl.innerHTML = `
      <div class="dp-cal-header">
        <button class="dp-cal-nav" id="calPrev">&lsaquo;</button>
        <span class="dp-cal-header__title">${monthNames[month]}, ${year}</span>
        <button class="dp-cal-nav" id="calNext">&rsaquo;</button>
      </div>
      <div class="dp-cal-grid">${daysHtml}</div>
    `;

    document.getElementById('calPrev')?.addEventListener('click', () => {
      renderMiniCalendar(new Date(year, month - 1, 1));
    });
    document.getElementById('calNext')?.addEventListener('click', () => {
      renderMiniCalendar(new Date(year, month + 1, 1));
    });

    // Click a date with events → highlight matching upcoming event cards
    miniCalendarEl.querySelectorAll('[data-cal-date]').forEach(day => {
      day.addEventListener('click', () => {
        const clickedDate = day.dataset.calDate;
        const matchingIds = activeEvents
          .filter(e => e.deadlineDate && e.deadlineDate.startsWith(clickedDate))
          .map(e => String(e.id));
        if (!matchingIds.length) return;
        document.querySelectorAll('.dp-upcoming-event[data-event-id]').forEach(card => {
          if (matchingIds.includes(card.dataset.eventId)) {
            card.classList.add('dp-upcoming-event--highlight');
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            setTimeout(() => card.classList.remove('dp-upcoming-event--highlight'), 1000);
          }
        });
      });
    });
  }

  // ── Load sections for selected event ─────────────────────────────────────

  async function loadSections(eventId) {
    closeStagePopover();
    if (!eventId) {
      if (eventDetailsEl) eventDetailsEl.style.display = 'none';
      if (sectionsCardEl) sectionsCardEl.style.display = 'none';
      if (previewBtn) previewBtn.style.display = 'none';
      return;
    }

    if (previewBtn) previewBtn.style.display = '';

    const ev = activeEvents.find(e => String(e.id) === String(eventId));

    try {
      const grid = await Api.get(`/api/workflow/status-grid?event_id=${eventId}`);

      // Show event details
      if (eventDetailsEl && ev) {
        eventDetailsEl.style.display = '';
        eventDetailsEl.innerHTML = `
            ${ev.occasion ? `<div class="dp-event-details__body">${ev.occasion}</div>` : ''}
            <div class="dp-event-details__meta">
              <span class="dp-event-details__meta-item">Country <strong>${escapeHtml(ev.countryName)}</strong></span>
              <span class="dp-event-details__meta-item">Language <span class="dp-lang-pill">${languageLabel(ev.language || 'EN')}</span></span>
              ${ev.deadlineDate ? `<span class="dp-event-details__meta-item">Deadline <strong>${formatDate(ev.deadlineDate)}</strong></span>` : ''}
            </div>
        `;
      }

      // Show sections
      const container = sectionsCardEl || legacyContainer;

      const isDS = grid.documentSubmitterId === user.id;
      const isDeputy = user.role === 'DEPUTY';

      // Filter sections: DS and Deputies see all sections.
      // Other users see sections assigned to their department,
      // OR sections where they have a RECEIVING_ role in the approval chain
      // (i.e. they belong to the DS home department reviewing cross-dept sections).
      const visibleSections = (isDS || isDeputy)
        ? (grid.sections || [])
        : (grid.sections || []).filter(s =>
            (s.departmentIds && s.departmentIds.includes(user.departmentId)) ||
            (s.userEffectiveRole && s.userEffectiveRole.startsWith('RECEIVING_') && s.chain && s.chain.includes(s.userEffectiveRole))
          );

      if (visibleSections.length === 0) {
        if (container) {
          container.style.display = '';
          container.innerHTML = '<div class="card"><div class="empty-state"><p>No sections for this event</p></div></div>';
        }
        return;
      }

      const allApproved = visibleSections.every(s => s.status && s.status.startsWith('approved_by_'));

      const sectionsToApprove = visibleSections.filter(s => {
        const uer = s.userEffectiveRole || user.role;
        const expectedStatus = 'submitted_to_' + uer.toLowerCase();
        return s.status === expectedStatus && s.currentHolderRole === uer;
      });

      let headerActions = '';
      if (isDS || isDeputy || user.role === 'SUPERVISOR' || user.role === 'SUPER_COLLABORATOR') {
        headerActions += `<button class="btn btn-outline" onclick="window.location.href='/pages/editor-all.html?event_id=${eventId}'">Open all Sections</button>`;
      }
      if (sectionsToApprove.length > 1) {
        headerActions += `<button class="btn dp-approve-all-btn" id="approveAllBtn">Approve all sections</button>`;
      }
      if (isDS && allApproved) {
        headerActions += `<button class="btn btn-primary" id="sendToLibraryBtn">Send to Library</button>`;
      }

      const sectionsHtml = visibleSections.map((s, i) => renderSectionRow(s, i, eventId, grid)).join('');

      if (container) {
        container.style.display = '';
        container.innerHTML = `
          <div class="card">
            <div class="dp-sections-card__header">
              <div>
                <h3 class="dp-sections-card__title">Required sections</h3>
                <p class="dp-sections-card__subtitle">Review section progress, check who updated each part, and take action.</p>
              </div>
              <div class="dp-sections-card__actions">${headerActions}</div>
            </div>
            <div class="dp-sections-table-header">
              <span>SECTION</span>
              <span>PROGRESS</span>
              <span style="text-align:right;">ACTIONS</span>
            </div>
            ${sectionsHtml}
          </div>
        `;
      }

      bindActions(eventId, grid);
      bindStagePopover();
      bindApproveAll(eventId, sectionsToApprove);
      bindSendToLibrary(eventId);

    } catch (e) {
      const container = sectionsCardEl || legacyContainer;
      if (container) {
        container.style.display = '';
        container.innerHTML = `<div class="card"><div class="msg msg-error">${escapeHtml(e.message)}</div></div>`;
      }
    }
  }

  function renderSectionRow(section, index, eventId, grid) {
    const returnReq = section.returnRequest;
    const returnInfo = section.returnInfo;
    const lastUpdated = section.lastUpdatedAt ? formatDateTime(section.lastUpdatedAt) : '';
    const lastUpdatedBy = section.lastUpdatedBy ? escapeHtml(section.lastUpdatedBy) : '';

    const deptInfo = (section.departmentNames && section.departmentNames.length > 0)
      ? section.departmentNames.map(n => escapeHtml(n)).join(', ')
      : '';

    // Build notification banners
    let noticeBanners = '';
    if (returnInfo) {
      noticeBanners += `<div class="dp-return-notice dp-return-notice--returned">Returned by ${escapeHtml(returnInfo.from || returnInfo.fromRole)}${returnInfo.note ? ': ' + escapeHtml(returnInfo.note) : ''}</div>`;
    }
    if (returnReq) {
      noticeBanners += `<div class="dp-return-notice">Return requested by ${escapeHtml(returnReq.from)}${returnReq.note ? ': ' + escapeHtml(returnReq.note) : ''}</div>`;
    }

    return `
      <div class="dp-section-row">
        <div class="dp-section-row__header">
          <div class="dp-section-row__info">
            <h4 class="dp-section-row__title">${escapeHtml(section.sectionLabel)}</h4>
            <div class="dp-section-row__meta">${deptInfo ? '<span style="color:var(--accent-blue);font-weight:600;">' + deptInfo + '</span> &middot; ' : ''}${lastUpdated}${lastUpdatedBy ? ' &middot; ' + lastUpdatedBy : ''}</div>
            ${noticeBanners}
          </div>
          <div class="dp-section-row__actions">
            ${renderActionLinks(section, eventId, grid)}
          </div>
        </div>
        ${renderPipeline(section, grid, eventId)}
        <button class="dp-history-toggle" data-section-id="${section.sectionId}">History &#9660;</button>
      </div>
    `;
  }

  function renderPipeline(section, grid, eventId) {
    const steps = section.steps || [];
    if (steps.length === 0) return '';
    const currentStatus = section.status || 'draft';

    let doneCount = 0;
    const stepStates = steps.map((step) => {
      const state = getStepState(step.role, currentStatus, section);
      if (state === 'done') doneCount++;
      return state;
    });

    let activeIdx = stepStates.indexOf('active');
    if (activeIdx === -1) activeIdx = doneCount - 1;
    const fillPct = steps.length > 1
      ? Math.max(0, Math.min(100, ((activeIdx >= 0 ? activeIdx : 0) / (steps.length - 1)) * 100))
      : 0;

    const stepsHtml = steps.map((step, i) => {
      const state = stepStates[i];
      const skipped = state === 'done' && !step.acted;
      const name = step.actorName || roleLabel(step.role);
      const subtitle = step.departmentName || (step.role === 'CURATOR' || step.role === 'DEPUTY' ? roleLabel(step.role) : '');
      return `
        <div class="dp-pipeline__step dp-pipeline__step--${state}${skipped ? ' dp-pipeline__step--skipped' : ''}">
          <span class="dp-pipeline__dot" data-stage-action="show-users" data-stage-event="${eventId}" data-stage-section="${section.sectionId}" data-stage-role="${step.role}">${i + 1}</span>
          <span class="dp-pipeline__name" title="${escapeHtml(name)}${subtitle ? ' (' + escapeHtml(subtitle) + ')' : ''}">${escapeHtml(name)}</span>
          ${subtitle ? `<span class="dp-pipeline__dept">${escapeHtml(subtitle)}</span>` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="dp-pipeline" style="position:relative;">
        <div class="dp-pipeline__bar">
          <div class="dp-pipeline__bar-fill" style="width:${fillPct}%"></div>
        </div>
        ${stepsHtml}
      </div>
    `;
  }

  function renderActionLinks(section, eventId, grid) {
    const effRole = section.userEffectiveRole || user.role;
    const holder = section.currentHolderRole;
    const isHolder = effRole === holder;
    const status = section.status || 'draft';
    const links = [];

    // Open (always)
    links.push(`<button class="dp-action-link dp-action-link--open" onclick="window.location.href='/pages/editor.html?event_id=${eventId}&section_id=${section.sectionId}'">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      OPEN
    </button>`);

    if (isHolder) {
      if (status === 'draft' || status.startsWith('returned_')) {
        links.push(`<button class="dp-action-link dp-action-link--submit" data-action="submit" data-event="${eventId}" data-section="${section.sectionId}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
          SUBMIT
        </button>`);
      }
      if (status === `submitted_to_${effRole.toLowerCase()}`) {
        links.push(`<button class="dp-action-link dp-action-link--approve" data-action="approve" data-event="${eventId}" data-section="${section.sectionId}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>
          APPROVE
        </button>`);
        links.push(`<button class="dp-action-link dp-action-link--return" data-action="return" data-event="${eventId}" data-section="${section.sectionId}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          RETURN
        </button>`);
      }
    } else if (!isHolder && status !== 'draft' && status) {
      // Only show Ask Return if the user is in the chain and the section
      // has already passed their step
      const chain = section.chain || [];
      const userIdx = chain.indexOf(effRole);
      const holderIdx = chain.indexOf(holder);
      if (userIdx !== -1 && holderIdx > userIdx) {
        links.push(`<button class="dp-action-link dp-action-link--ask-return" data-action="ask-to-return" data-event="${eventId}" data-section="${section.sectionId}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          ASK RETURN
        </button>`);
      }
    }

    // Push Section — shown for both holders and non-holders when canPush is true
    if (section.canPush) {
      links.push(`<button class="dp-action-link dp-action-link--push" data-action="push-section" data-event="${eventId}" data-section="${section.sectionId}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
        PUSH SECTION
      </button>`);
    }

    // Pull Section — pull from a user earlier in the chain
    if (section.canPull) {
      links.push(`<button class="dp-action-link dp-action-link--pull" data-action="pull-section" data-event="${eventId}" data-section="${section.sectionId}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
        PULL SECTION
      </button>`);
    }

    return links.join('');
  }

  // ── Stage Users Popover ──────────────────────────────────────────────────

  function closeStagePopover() {
    if (activePopover) {
      activePopover.remove();
      activePopover = null;
    }
  }

  function createStagePopover(anchorEl, initialHtml) {
    const popover = document.createElement('div');
    popover.className = 'dp-stage-popover';
    popover.innerHTML = `
      <div class="dp-popover__header">
        <span class="dp-popover__title">Eligible Users</span>
        <button class="dp-popover__close">&times;</button>
      </div>
      <div class="dp-popover__body">${initialHtml}</div>
    `;
    document.body.appendChild(popover);
    activePopover = popover;

    // Position below the anchor dot
    const rect = anchorEl.getBoundingClientRect();
    const popW = popover.offsetWidth;
    let top = rect.bottom + 8;
    let left = rect.left + rect.width / 2 - popW / 2;
    if (left < 8) left = 8;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
    popover.style.top = top + 'px';
    popover.style.left = left + 'px';

    popover.querySelector('.dp-popover__close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeStagePopover();
    });
    popover.addEventListener('click', (e) => e.stopPropagation());

    return popover;
  }

  function renderStageUsers(data) {
    if (!data.users || data.users.length === 0) {
      return '<div class="dp-popover__empty">No eligible users</div>';
    }
    const label = roleLabel(data.role);
    const rows = data.users.map(u => `
      <div class="dp-popover__user">
        <span class="dp-popover__user-name">${escapeHtml(u.fullName)}</span>
        ${u.departmentName ? `<span class="dp-popover__user-dept">${escapeHtml(u.departmentName)}</span>` : ''}
      </div>
    `).join('');
    return `<div class="dp-popover__role-title">${escapeHtml(label)}</div>${rows}`;
  }

  function bindStagePopover() {
    document.querySelectorAll('[data-stage-action="show-users"]').forEach(dot => {
      dot.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeStagePopover();
        const eventId = dot.dataset.stageEvent;
        const sectionId = dot.dataset.stageSection;
        const role = dot.dataset.stageRole;
        const popover = createStagePopover(dot, '<div class="dp-popover__loading">Loading…</div>');
        try {
          const data = await Api.get(`/api/workflow/stage-users?event_id=${eventId}&section_id=${sectionId}&role=${encodeURIComponent(role)}`);
          popover.querySelector('.dp-popover__body').innerHTML = renderStageUsers(data);
        } catch (err) {
          popover.querySelector('.dp-popover__body').innerHTML = `<div class="dp-popover__empty">${escapeHtml(err.message)}</div>`;
        }
      });
    });
    document.addEventListener('click', closeStagePopover);
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

  function bindActions(eventId, grid) {
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
          } else if (action === 'approve') {
            if (!confirm('Approve this section?')) return;
            await Api.post('/api/workflow/approve', { eventId: evId, sectionId });
          } else if (action === 'return') {
            const comment = prompt('Return comment:');
            if (comment === null) return;
            await Api.post('/api/workflow/return', { eventId: evId, sectionId, comment: comment || undefined });
          } else if (action === 'ask-to-return') {
            const note = prompt('Reason for return request:');
            if (note === null) return;
            await Api.post('/api/workflow/ask-to-return', { eventId: evId, sectionId, note: note || undefined });
          } else if (action === 'push-section') {
            if (!confirm('Push this section directly to the responsible department?')) return;
            await Api.post('/api/workflow/push-section', { eventId: evId, sectionId });
          } else if (action === 'pull-section') {
            if (!confirm('Pull this section to yourself?')) return;
            await Api.post('/api/workflow/pull-section', { eventId: evId, sectionId });
          }
          loadSections(evId);
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  function bindApproveAll(eventId, sectionsToApprove) {
    const btn = document.getElementById('approveAllBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!confirm(`Approve all ${sectionsToApprove.length} sections?`)) return;
      try {
        for (const s of sectionsToApprove) {
          await Api.post('/api/workflow/approve', { eventId: parseInt(eventId), sectionId: s.sectionId });
        }
        loadSections(eventId);
      } catch (err) {
        alert(err.message);
        loadSections(eventId);
      }
    });
  }

  function bindSendToLibrary(eventId) {
    const btn = document.getElementById('sendToLibraryBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!confirm('Send this document to the library? This marks it as completed.')) return;
      try {
        await Api.post('/api/workflow/send-to-library', { eventId: parseInt(eventId) });
        alert('Document sent to library successfully.');
        loadSections(eventId);
      } catch (err) {
        alert(err.message);
      }
    });
  }

  eventSelect.addEventListener('change', () => loadSections(eventSelect.value));
  if (eventSelect.value) loadSections(eventSelect.value);
})();
