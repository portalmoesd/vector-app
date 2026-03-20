/**
 * Calendar / Event List Page
 * - Upcoming and Past event tabs
 * - Client-side filtering (keyword, country, date range)
 * - Pagination (5 per page)
 * - Create / View / Edit / End event modals
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

  // Roles that can create events
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

  // ── Load data ──────────────────────────────────────────────────────────────

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

  // Populate country filter
  filterCountry.innerHTML = '<option value="">All countries</option>' +
    countries.map(c => `<option value="${c.id}">${escapeHtml(c.name_en || c.nameEn || c.name)}</option>`).join('');

  // ── Render ─────────────────────────────────────────────────────────────────

  function getFiltered() {
    const kw = filterKeyword.value.toLowerCase().trim();
    const countryId = filterCountry.value ? parseInt(filterCountry.value) : null;
    const dateFrom = filterDateFrom.value ? new Date(filterDateFrom.value) : null;
    const dateTo = filterDateTo.value ? new Date(filterDateTo.value) : null;

    return events.filter(e => {
      // Tab filter
      const isUpcoming = e.isActive;
      if (currentTab === 'upcoming' && !isUpcoming) return false;
      if (currentTab === 'past' && isUpcoming) return false;

      // Keyword
      if (kw) {
        const match = (e.title || '').toLowerCase().includes(kw) ||
                      (e.occasion || '').toLowerCase().includes(kw) ||
                      (e.countryName || '').toLowerCase().includes(kw);
        if (!match) return false;
      }

      // Country
      if (countryId && e.countryId !== countryId) return false;

      // Date range
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
            <button class="btn btn-outline" onclick="viewEvent(${e.id})">View</button>
            ${e.isActive && CAN_CREATE.includes(user.role) ? `<button class="btn btn-outline" onclick="editEvent(${e.id})">Edit</button>` : ''}
            ${e.isActive && CAN_END.includes(user.role) ? `<button class="btn btn-danger" onclick="endEvent(${e.id})">End</button>` : ''}
          </div>
        </div>
      `;
    }).join('');

    // Pagination
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

  window.goPage = function(p) {
    currentPage = p;
    render();
  };

  // ── Modal helpers ──────────────────────────────────────────────────────────

  function showModal(title, bodyHtml, saveLabel, saveFn) {
    modalTitle.textContent = title;
    modalBody.innerHTML = bodyHtml;
    document.getElementById('eventModalSave').textContent = saveLabel || 'Save';
    onModalSave = saveFn;
    if (saveFn) {
      document.getElementById('eventModalSave').style.display = '';
    } else {
      document.getElementById('eventModalSave').style.display = 'none';
    }
    modal.style.display = 'flex';
  }

  function hideModal() { modal.style.display = 'none'; onModalSave = null; }

  modalCancel.addEventListener('click', hideModal);
  modalSave.addEventListener('click', () => { if (onModalSave) onModalSave(); });

  // ── View Event ─────────────────────────────────────────────────────────────

  window.viewEvent = async function(id) {
    try {
      const e = await Api.get(`/api/events/${id}`);
      const sectionsHtml = e.sections.map((s, i) =>
        `<li>${escapeHtml(s.title)}</li>`
      ).join('');

      showModal('Event Details', `
        <div style="font-size:14px;line-height:1.8;">
          <p><strong>Title:</strong> ${escapeHtml(e.title)}</p>
          <p><strong>Country:</strong> ${escapeHtml(e.countryName)}</p>
          <p><strong>Language:</strong> ${e.language}</p>
          <p><strong>Document Submitter:</strong> ${escapeHtml(e.documentSubmitterName)} (${roleLabel(e.documentSubmitterRole)})</p>
          ${e.deputyName ? `<p><strong>Deputy:</strong> ${escapeHtml(e.deputyName)}</p>` : ''}
          <p><strong>Curator Required:</strong> ${e.curatorRequired ? 'Yes' : 'No'}</p>
          ${e.occasion ? `<p><strong>Occasion:</strong> ${escapeHtml(e.occasion)}</p>` : ''}
          ${e.deadlineDate ? `<p><strong>Deadline:</strong> ${formatDate(e.deadlineDate)}</p>` : ''}
          <p><strong>Status:</strong> ${e.status}</p>
          <p><strong>Sections:</strong></p>
          <ol style="margin:0 0 0 20px;">${sectionsHtml || '<li>None</li>'}</ol>
        </div>
      `, null, null);
    } catch (e) {
      alert(e.message);
    }
  };

  // ── Edit Event ─────────────────────────────────────────────────────────────

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
          <input class="form-input" type="date" id="editDeadline" value="${e.deadlineDate || ''}" />
        </div>
        <div class="form-group">
          <label class="form-label">Occasion</label>
          <textarea class="form-input" id="editOccasion" rows="2">${escapeHtml(e.occasion || '')}</textarea>
        </div>
      `, 'Save', async () => {
        try {
          await Api.patch(`/api/events/${id}`, {
            title: document.getElementById('editTitle').value.trim(),
            language: document.getElementById('editLanguage').value,
            deadlineDate: document.getElementById('editDeadline').value || null,
            occasion: document.getElementById('editOccasion').value.trim() || null,
          });
          hideModal();
          events = await Api.get('/api/events');
          render();
        } catch (err) { alert(err.message); }
      });
    } catch (e) {
      alert(e.message);
    }
  };

  // ── End Event ──────────────────────────────────────────────────────────────

  window.endEvent = async function(id) {
    if (!confirm('End this event? This action cannot be undone.')) return;
    try {
      await Api.post(`/api/events/${id}/end`);
      events = await Api.get('/api/events');
      render();
    } catch (e) {
      alert(e.message);
    }
  };

  // ── Create Event ───────────────────────────────────────────────────────────

  createBtn.addEventListener('click', async () => {
    // Load deputies for dropdown
    try {
      deputies = await Api.get('/api/admin/deputies');
    } catch (e) { deputies = []; }

    const countryOpts = countries.map(c =>
      `<option value="${c.id}">${escapeHtml(c.name_en || c.nameEn || c.name)}</option>`
    ).join('');

    const deptOpts = departments.map(d =>
      `<option value="${d.id}">${escapeHtml(d.nameEn || d.name)}</option>`
    ).join('');

    const deputyOpts = deputies.map(d =>
      `<option value="${d.id}">${escapeHtml(d.fullName)}</option>`
    ).join('');

    showModal('Create Event', `
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
        <label class="form-label">Deputy</label>
        <select class="form-select" id="newDeputy">
          <option value="">— Select —</option>
          ${deputyOpts}
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
        <input class="form-input" type="date" id="newDeadline" />
      </div>
      <div class="form-group">
        <label class="form-label">Occasion</label>
        <textarea class="form-input" id="newOccasion" rows="2"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label"><input type="checkbox" id="newCurator" /> Curator Required</label>
      </div>
      <div class="form-group">
        <label class="form-label">Sections</label>
        <div id="sectionRows"></div>
        <button class="btn btn-outline" type="button" id="addSectionRow" style="margin-top:8px;">+ Add Section</button>
      </div>
    `, 'Create', async () => {
      const title = document.getElementById('newTitle').value.trim();
      const countryId = parseInt(document.getElementById('newCountry').value);
      const dsRole = document.getElementById('newDSRole').value;
      const deputyId = document.getElementById('newDeputy').value ? parseInt(document.getElementById('newDeputy').value) : null;
      const language = document.getElementById('newLanguage').value;
      const deadlineDate = document.getElementById('newDeadline').value || null;
      const occasion = document.getElementById('newOccasion').value.trim() || null;
      const curatorRequired = document.getElementById('newCurator').checked;

      if (!title || !countryId || !dsRole) {
        alert('Title, Country, and DS Role are required');
        return;
      }

      // Gather sections
      const sectionRows = document.querySelectorAll('.section-row');
      const sections = [];
      sectionRows.forEach(row => {
        const sTitle = row.querySelector('.sec-title').value.trim();
        const deptSelect = row.querySelector('.sec-depts');
        const deptIds = Array.from(deptSelect.selectedOptions).map(o => parseInt(o.value));
        if (sTitle) sections.push({ title: sTitle, departmentIds: deptIds });
      });

      // DS ID: For DEPUTY role, use selected deputy. Otherwise, use current user.
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
          curatorRequired,
          language, deadlineDate, occasion,
          sections,
        });
        hideModal();
        events = await Api.get('/api/events');
        render();
      } catch (err) { alert(err.message); }
    });

    // Section row management
    const sectionRows = document.getElementById('sectionRows');
    const addSectionRow = document.getElementById('addSectionRow');

    function createSectionRow() {
      const row = document.createElement('div');
      row.className = 'section-row';
      row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:flex-start;';
      row.innerHTML = `
        <input class="form-input sec-title" placeholder="Section title" style="flex:1;" />
        <select class="form-select sec-depts" multiple style="flex:1;min-height:60px;">
          ${deptOpts}
        </select>
        <button class="btn btn-outline" type="button" onclick="this.parentElement.remove()" style="padding:6px 10px;">✕</button>
      `;
      sectionRows.appendChild(row);
    }

    addSectionRow.addEventListener('click', createSectionRow);
    createSectionRow(); // Start with one section row
  });

  // ── Initial render ─────────────────────────────────────────────────────────
  render();
})();
