/**
 * Calendar / Event List Page
 * - Upcoming and Past event tabs
 * - Client-side filtering (keyword, country, date range)
 * - Pagination (5 per page)
 * - Create / View / Edit / End event modals
 * - When Deputy is selected, sections auto-fill from their template
 * - Departments inside each section shown as checkboxes (can untick)
 */
(async function () {
  await App.init();

  const user = Api.getUser();
  if (!user) return;

  const PER_PAGE = 5;
  let events = [];
  let countries = [];
  let departments = [];
  let deputies = [];
  let templates = [];
  let currentTab = 'upcoming';
  let currentPage = 1;

  const createBtn = document.getElementById('createEventBtn');
  const eventsList = document.getElementById('eventsList');
  const paginationEl = document.getElementById('pagination');
  const modal = document.getElementById('eventModal');
  const modalTitle = document.getElementById('eventModalTitle');
  const modalBody = document.getElementById('eventModalBody');
  const modalCancel = document.getElementById('eventModalCancel');
  const modalSave = document.getElementById('eventModalSave');
  let onModalSave = null;

  const CAN_CREATE = ['ADMIN', 'PROTOCOL', 'DEPUTY', 'SUPERVISOR', 'SUPER_COLLABORATOR'];
  const CAN_END = ['ADMIN', 'PROTOCOL', 'DEPUTY', 'SUPERVISOR'];

  if (CAN_CREATE.includes(user.role)) {
    createBtn.style.display = '';
  }

  // ── Tab switching ──────────────────────────────────────────────────────────

  document.querySelectorAll('.event-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.event-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      currentPage = 1;
      render();
    });
  });

  // ── Filters ────────────────────────────────────────────────────────────────

  const filterKeyword = document.getElementById('filterKeyword');
  const filterCountry = document.getElementById('filterCountry');
  const filterDateFrom = document.getElementById('filterDateFrom');
  const filterDateTo = document.getElementById('filterDateTo');

  [filterKeyword, filterCountry, filterDateFrom, filterDateTo].forEach(el => {
    el.addEventListener('input', () => { currentPage = 1; render(); });
    el.addEventListener('change', () => { currentPage = 1; render(); });
  });

  // ── Load data ────────────────────────────────────────────────────────────

  try {
    [events, countries, departments] = await Promise.all([
      Api.get('/api/events'),
      Api.get('/api/countries'),
      Api.get('/api/departments'),
    ]);
  } catch (e) {
    eventsList.innerHTML = `<div class="msg msg-error">${escapeHtml(e.message)}</div>`;
    return;
  }

  // Build department lookup
  const deptById = {};
  departments.forEach(d => { deptById[d.id] = d; });

  filterCountry.innerHTML = '<option value="">All countries</option>' +
    countries.map(c => `<option value="${c.id}">${escapeHtml(c.name_en || c.nameEn || c.name)}</option>`).join('');

  // ── Render ───────────────────────────────────────────────────────────────

  function getFiltered() {
    const kw = filterKeyword.value.toLowerCase().trim();
    const countryId = filterCountry.value ? parseInt(filterCountry.value) : null;
    const dateFrom = filterDateFrom.value ? new Date(filterDateFrom.value) : null;
    const dateTo = filterDateTo.value ? new Date(filterDateTo.value) : null;

    return events.filter(e => {
      const isUpcoming = e.isActive;
      if (currentTab === 'upcoming' && !isUpcoming) return false;
      if (currentTab === 'past' && isUpcoming) return false;

      if (kw) {
        const match = (e.title || '').toLowerCase().includes(kw) ||
                      (e.occasion || '').toLowerCase().includes(kw) ||
                      (e.countryName || '').toLowerCase().includes(kw);
        if (!match) return false;
      }
      if (countryId && e.countryId !== countryId) return false;
      const created = new Date(e.createdAt);
      if (dateFrom && created < dateFrom) return false;
      if (dateTo && created > new Date(dateTo.getTime() + 86400000)) return false;
      return true;
    });
  }

  function render() {
    const filtered = getFiltered();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PER_PAGE;
    const page = filtered.slice(start, start + PER_PAGE);

    if (page.length === 0) {
      eventsList.innerHTML = '<div class="empty-state"><p>No events found</p></div>';
      paginationEl.innerHTML = '';
      return;
    }

    eventsList.innerHTML = page.map(e => {
      const statusPill = e.isActive
        ? `<span class="pill pill-green">${e.status || 'Active'}</span>`
        : `<span class="pill pill-gray">${e.status || 'Ended'}</span>`;

      return `
        <div class="event-card">
          <div class="event-card-info">
            <h4>${escapeHtml(e.title)} ${statusPill}</h4>
            <div class="event-card-meta">
              <span>${escapeHtml(e.countryName)}</span>
              <span>Language: ${e.language}</span>
              <span>DS: ${escapeHtml(e.documentSubmitterName)}</span>
              ${e.deadlineDate ? `<span>Deadline: ${formatDate(e.deadlineDate)}</span>` : ''}
              <span>Created: ${formatDate(e.createdAt)}</span>
            </div>
          </div>
          <div class="event-card-actions">
            <button class="btn btn-outline" onclick="viewEvent(${e.id})">
              <span class="icon" style="--icon-url: url(/assets/view-icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url); width:16px;height:16px;display:inline-block;background:currentColor;"></span>
              View
            </button>
            ${e.isActive && CAN_CREATE.includes(user.role) ? `<button class="btn btn-outline" onclick="editEvent(${e.id})">
              <span class="icon" style="--icon-url: url(/assets/edit-icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url); width:16px;height:16px;display:inline-block;background:currentColor;"></span>
              Edit
            </button>` : ''}
            ${e.isActive && CAN_END.includes(user.role) ? `<button class="btn btn-danger" onclick="endEvent(${e.id})">
              <span class="icon" style="--icon-url: url(/assets/end-icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url); width:16px;height:16px;display:inline-block;background:currentColor;"></span>
              End
            </button>` : ''}
          </div>
        </div>
      `;
    }).join('');

    if (totalPages > 1) {
      let btns = [];
      btns.push(`<button ${currentPage === 1 ? 'disabled' : ''} onclick="goPage(${currentPage - 1})">Prev</button>`);
      for (let i = 1; i <= totalPages; i++) {
        btns.push(`<button class="${i === currentPage ? 'active' : ''}" onclick="goPage(${i})">${i}</button>`);
      }
      btns.push(`<button ${currentPage === totalPages ? 'disabled' : ''} onclick="goPage(${currentPage + 1})">Next</button>`);
      paginationEl.innerHTML = btns.join('');
    } else {
      paginationEl.innerHTML = '';
    }
  }

  window.goPage = function(p) { currentPage = p; render(); };

  // ── Modal helpers ────────────────────────────────────────────────────────

  function showModal(title, bodyHtml, saveLabel, saveFn) {
    modalTitle.textContent = title;
    modalBody.innerHTML = bodyHtml;
    document.getElementById('eventModalSave').textContent = saveLabel || 'Save';
    onModalSave = saveFn;
    document.getElementById('eventModalSave').style.display = saveFn ? '' : 'none';
    modal.style.display = 'flex';
  }

  function hideModal() { modal.style.display = 'none'; onModalSave = null; }

  modalCancel.addEventListener('click', hideModal);
  modalSave.addEventListener('click', () => { if (onModalSave) onModalSave(); });

  // ── View Event ───────────────────────────────────────────────────────────

  window.viewEvent = async function(id) {
    try {
      const e = await Api.get(`/api/events/${id}`);
      const sectionsHtml = e.sections.map(s => `<li>${escapeHtml(s.title)}</li>`).join('');
      showModal('Event Details', `
        <div style="font-size:14px;line-height:1.8;">
          <p><strong>Title:</strong> ${escapeHtml(e.title)}</p>
          <p><strong>Country:</strong> ${escapeHtml(e.countryName)}</p>
          <p><strong>Language:</strong> ${e.language}</p>
          <p><strong>Document Submitter:</strong> ${escapeHtml(e.documentSubmitterName)} (${roleLabel(e.documentSubmitterRole)})</p>
          ${e.deputyName ? `<p><strong>Deputy:</strong> ${escapeHtml(e.deputyName)}</p>` : ''}
          ${e.supervisorName ? `<p><strong>Responsible Supervisor:</strong> ${escapeHtml(e.supervisorName)}</p>` : ''}
          <p><strong>Curator Required:</strong> ${e.curatorRequired ? 'Yes' : 'No'}</p>
          ${e.occasion ? `<p><strong>Task:</strong> ${escapeHtml(e.occasion)}</p>` : ''}
          ${e.deadlineDate ? `<p><strong>Deadline:</strong> ${formatDate(e.deadlineDate)}</p>` : ''}
          <p><strong>Status:</strong> ${e.status}</p>
          <p><strong>Sections:</strong></p>
          <ol style="margin:0 0 0 20px;">${sectionsHtml || '<li>None</li>'}</ol>
        </div>
      `, null, null);
    } catch (e) { alert(e.message); }
  };

  // ── Edit Event ───────────────────────────────────────────────────────────

  window.editEvent = async function(id) {
    try {
      const e = await Api.get(`/api/events/${id}`);
      showModal('Edit Event', `
        <div class="form-group">
          <label class="form-label">Title</label>
          <input class="form-input" id="editTitle" value="${escapeHtml(e.title)}" />
        </div>
        <div class="form-group">
          <label class="form-label">Language</label>
          <select class="form-select" id="editLanguage">
            ${['EN','FR','AR','ES','RU','ZH','PT','DE'].map(l =>
              `<option value="${l}" ${l === e.language ? 'selected' : ''}>${l}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Deadline</label>
          <input class="form-input" type="date" id="editDeadline" lang="en-GB" value="${e.deadlineDate || ''}" />
        </div>
        <div class="form-group">
          <label class="form-label">Task</label>
          <div id="editOccasionWrap"></div>
        </div>
      `, 'Save', async () => {
        try {
          await Api.patch(`/api/events/${id}`, {
            title: document.getElementById('editTitle').value.trim(),
            language: document.getElementById('editLanguage').value,
            deadlineDate: document.getElementById('editDeadline').value || null,
            occasion: editOccasionEditor.getHtml() || null,
          });
          hideModal();
          events = await Api.get('/api/events');
          render();
        } catch (err) { alert(err.message); }
      });
      const editOccasionEditor = window.GCP.createSimpleEditor(document.getElementById('editOccasionWrap'), { placeholder: 'Enter task description...' });
      editOccasionEditor.setHtml(e.occasion || '');
    } catch (e) { alert(e.message); }
  };

  // ── End Event ────────────────────────────────────────────────────────────

  window.endEvent = async function(id) {
    if (!confirm('End this event? This action cannot be undone.')) return;
    try {
      await Api.post(`/api/events/${id}/end`);
      events = await Api.get('/api/events');
      render();
    } catch (e) { alert(e.message); }
  };

  // ── Section row — collapsible dropdown for departments ─────────────────

  function createSectionRow(container, title, selectedDeptIds) {
    const row = document.createElement('div');
    row.className = 'section-row';
    row.style.cssText = 'border:1px solid var(--border-color,#ddd);border-radius:8px;margin-bottom:8px;background:var(--bg-card,#fff);overflow:hidden;';
    const selected = new Set(selectedDeptIds || []);
    const deptCount = selectedDeptIds ? selectedDeptIds.length : 0;

    const deptCheckboxes = selectedDeptIds && selectedDeptIds.length > 0
      ? selectedDeptIds.map(dId => {
          const d = deptById[dId];
          if (!d) return '';
          return `<label style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:13px;cursor:pointer;">
            <input type="checkbox" class="sec-dept-cb" data-dept-id="${d.id}" checked />
            ${escapeHtml(d.nameEn || d.name)}
          </label>`;
        }).join('')
      : '';

    row.innerHTML = `
      <div class="sec-header" style="display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;user-select:none;">
        <span class="sec-toggle" style="font-size:11px;color:#888;transition:transform .2s;">\u25B6</span>
        <input class="form-input sec-title" placeholder="Section title" style="flex:1;font-weight:600;border:none;padding:0;background:transparent;" value="${title ? escapeHtml(title) : ''}" onclick="event.stopPropagation()" />
        <span class="sec-dept-count" style="font-size:12px;color:#666;white-space:nowrap;">${deptCount} dept(s)</span>
        <button class="btn btn-outline" type="button" style="padding:2px 8px;font-size:11px;color:#dc2626;" onclick="event.stopPropagation();this.closest('.section-row').remove()">\u2715</button>
      </div>
      <div class="sec-body" style="display:none;padding:0 12px 12px 30px;border-top:1px solid var(--border-color,#eee);">
        <div class="sec-depts-container" style="padding:8px 0;">
          ${deptCheckboxes}
        </div>
        <select class="form-select sec-add-dept" style="font-size:12px;padding:4px 8px;margin-top:4px;">
          <option value="">+ Add department...</option>
          ${departments.map(d =>
            `<option value="${d.id}" ${selected.has(d.id) ? 'disabled' : ''}>${escapeHtml(d.nameEn || d.name)}</option>`
          ).join('')}
        </select>
      </div>
    `;

    container.appendChild(row);

    // Toggle expand/collapse
    const header = row.querySelector('.sec-header');
    const body = row.querySelector('.sec-body');
    const toggle = row.querySelector('.sec-toggle');
    header.addEventListener('click', () => {
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      toggle.style.transform = open ? '' : 'rotate(90deg)';
    });

    // Update dept count when checkboxes change
    function updateCount() {
      const count = row.querySelectorAll('.sec-dept-cb:checked').length;
      row.querySelector('.sec-dept-count').textContent = count + ' dept(s)';
    }
    row.addEventListener('change', (e) => {
      if (e.target.classList.contains('sec-dept-cb')) updateCount();
    });

    // Add department on select
    const addDeptSelect = row.querySelector('.sec-add-dept');
    addDeptSelect.addEventListener('change', () => {
      const deptId = parseInt(addDeptSelect.value);
      if (!deptId) return;
      const d = deptById[deptId];
      if (!d) return;

      const existing = row.querySelector(`.sec-dept-cb[data-dept-id="${deptId}"]`);
      if (existing) { addDeptSelect.value = ''; return; }

      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 0;font-size:13px;cursor:pointer;';
      label.innerHTML = `
        <input type="checkbox" class="sec-dept-cb" data-dept-id="${d.id}" checked />
        ${escapeHtml(d.nameEn || d.name)}
      `;
      row.querySelector('.sec-depts-container').appendChild(label);
      addDeptSelect.querySelector(`option[value="${deptId}"]`).disabled = true;
      addDeptSelect.value = '';
      updateCount();
    });
  }

  function getSectionsFromRows() {
    const sections = [];
    document.querySelectorAll('.section-row').forEach(row => {
      const sTitle = row.querySelector('.sec-title').value.trim();
      const deptIds = Array.from(row.querySelectorAll('.sec-dept-cb:checked'))
        .map(cb => parseInt(cb.dataset.deptId));
      if (sTitle) sections.push({ title: sTitle, departmentIds: deptIds });
    });
    return sections;
  }

  // ── Create Event ─────────────────────────────────────────────────────────

  createBtn.addEventListener('click', async () => {
    try {
      [deputies, templates] = await Promise.all([
        Api.get('/api/admin/deputies'),
        Api.get('/api/templates'),
      ]);
    } catch (e) { deputies = []; templates = []; }

    const countryOpts = countries.map(c =>
      `<option value="${c.id}">${escapeHtml(c.name_en || c.nameEn || c.name)}</option>`
    ).join('');

    const deputyOpts = deputies.map(d =>
      `<option value="${d.id}">${escapeHtml(d.fullName)}</option>`
    ).join('');

    showModal('Create Event', `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 20px;">
        <div class="form-group">
          <label class="form-label">Title *</label>
          <input class="form-input" id="newTitle" required />
        </div>
        <div class="form-group">
          <label class="form-label">Country *</label>
          <select class="form-select" id="newCountry">
            <option value="">— Select —</option>
            ${countryOpts}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Document Submitter Role *</label>
          <select class="form-select" id="newDSRole">
            <option value="DEPUTY">Deputy</option>
            <option value="SUPERVISOR">Supervisor</option>
            <option value="SUPER_COLLABORATOR">Super-Collaborator</option>
          </select>
        </div>
        <div class="form-group" id="deputyGroup">
          <label class="form-label">Deputy *</label>
          <select class="form-select" id="newDeputy">
            <option value="">— Select Deputy —</option>
            ${deputyOpts}
          </select>
        </div>
        <div class="form-group" id="supervisorGroup">
          <label class="form-label">Responsible Supervisor *</label>
          <select class="form-select" id="newSupervisor">
            <option value="">— Select Supervisor —</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Language</label>
          <select class="form-select" id="newLanguage">
            ${['EN','FR','AR','ES','RU','ZH','PT','DE'].map(l =>
              `<option value="${l}">${l}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Deadline</label>
          <input class="form-input" type="date" id="newDeadline" lang="en-GB" />
        </div>
        <div class="form-group">
          <label class="form-label">Curator Required</label>
          <select class="form-select" id="newCurator">
            <option value="no" selected>No</option>
            <option value="yes">Yes</option>
          </select>
        </div>
        <div class="form-group" style="grid-column:1/-1;">
          <label class="form-label">Task</label>
          <div id="newOccasionWrap"></div>
        </div>
        <div class="form-group" style="grid-column:1/-1;">
          <label class="form-label">Template</label>
          <select class="form-select" id="newTemplate">
            <option value="">— Select Template —</option>
          </select>
        </div>
        <div class="form-group" style="grid-column:1/-1;">
          <label class="form-label" style="font-weight:700;">Sections</label>
          <div id="sectionRows"></div>
          <button class="btn btn-outline" type="button" id="addSectionRow" style="margin-top:8px;">+ Add Section</button>
        </div>
      </div>
    `, 'Create', async () => {
      const title = document.getElementById('newTitle').value.trim();
      const countryId = parseInt(document.getElementById('newCountry').value);
      const dsRole = document.getElementById('newDSRole').value;
      const deputyId = document.getElementById('newDeputy').value ? parseInt(document.getElementById('newDeputy').value) : null;
      const supervisorId = document.getElementById('newSupervisor').value ? parseInt(document.getElementById('newSupervisor').value) : null;
      const language = document.getElementById('newLanguage').value;
      const deadlineDate = document.getElementById('newDeadline').value || null;
      const occasion = newOccasionEditor.getHtml() || null;
      const curatorRequired = document.getElementById('newCurator').value === 'yes';

      if (!title || !countryId || !dsRole) {
        alert('Title, Country, and DS Role are required');
        return;
      }

      const sections = getSectionsFromRows();
      if (sections.length === 0) {
        alert('Add at least one section');
        return;
      }

      let documentSubmitterId;
      if (dsRole === 'DEPUTY') {
        documentSubmitterId = deputyId || user.id;
      } else {
        documentSubmitterId = user.id;
      }

      try {
        await Api.post('/api/events', {
          title, countryId,
          documentSubmitterRole: dsRole,
          documentSubmitterId,
          deputyId,
          supervisorId,
          curatorRequired,
          language, deadlineDate, occasion,
          sections,
        });
        hideModal();
        events = await Api.get('/api/events');
        render();
      } catch (err) { alert(err.message); }
    });

    const newOccasionEditor = window.GCP.createSimpleEditor(document.getElementById('newOccasionWrap'), { placeholder: 'Enter task description...' });

    const sectionRowsContainer = document.getElementById('sectionRows');
    const addSectionRowBtn = document.getElementById('addSectionRow');
    const templateSelect = document.getElementById('newTemplate');

    addSectionRowBtn.addEventListener('click', () => createSectionRow(sectionRowsContainer));

    // Populate template dropdown
    templateSelect.innerHTML = '<option value="">— Select Template —</option>' +
      templates.map(t => {
        const label = t.isDefault ? t.name : t.name;
        const badge = t.isDefault ? ' (Default)' : '';
        return `<option value="${t.id}">${escapeHtml(label)}${badge} — ${t.sections.length} section(s)</option>`;
      }).join('');

    // When template is selected → auto-fill sections
    templateSelect.addEventListener('change', () => {
      const tplId = templateSelect.value ? parseInt(templateSelect.value) : null;
      if (!tplId) return;

      const tpl = templates.find(t => t.id === tplId);
      if (!tpl || !tpl.sections || tpl.sections.length === 0) return;

      sectionRowsContainer.innerHTML = '';
      for (const sec of tpl.sections) {
        createSectionRow(sectionRowsContainer, sec.title, sec.departmentIds);
      }

      document.getElementById('newCurator').value = tpl.curatorRequired ? 'yes' : 'no';
    });

    // Load supervisors for selected deputy
    async function loadSupervisors(deputyId) {
      const supervisorSelect = document.getElementById('newSupervisor');
      if (!deputyId) {
        supervisorSelect.innerHTML = '<option value="">— Select Supervisor —</option>';
        return;
      }
      try {
        const supervisors = await Api.get(`/api/admin/supervisors?deputy_id=${deputyId}`);
        supervisorSelect.innerHTML = '<option value="">— Select Supervisor —</option>' +
          supervisors.map(s => `<option value="${s.id}">${escapeHtml(s.fullName)}${s.departmentName ? ' — ' + escapeHtml(s.departmentName) : ''}</option>`).join('');
      } catch (e) {
        supervisorSelect.innerHTML = '<option value="">— No supervisors found —</option>';
      }
    }

    // When deputy changes, reload supervisors
    document.getElementById('newDeputy').addEventListener('change', () => {
      const deputyId = document.getElementById('newDeputy').value;
      loadSupervisors(deputyId);
    });

    // Show/hide deputy + supervisor groups based on DS role
    document.getElementById('newDSRole').addEventListener('change', () => {
      const dsRole = document.getElementById('newDSRole').value;
      document.getElementById('deputyGroup').style.display =
        dsRole === 'DEPUTY' ? '' : 'none';
      document.getElementById('supervisorGroup').style.display =
        dsRole === 'DEPUTY' ? '' : 'none';
      if (dsRole !== 'DEPUTY') {
        document.getElementById('newSupervisor').innerHTML = '<option value="">— Select Supervisor —</option>';
      }
    });
  });

  // ── Initial render ───────────────────────────────────────────────────────
  render();
})();
