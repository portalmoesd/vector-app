/**
 * Calendar Templates — manage section templates.
 * Any user who can create events can also create their own templates.
 * The Default Template is shown but cannot be deleted.
 */
(async function () {
  const user = Api.getUser();
  if (!user) return;

  const CAN_CREATE = ['ADMIN', 'PROTOCOL', 'DEPUTY', 'SUPERVISOR', 'SUPER_COLLABORATOR'];
  if (!CAN_CREATE.includes(user.role)) return;

  const card = document.getElementById('templatesCard');
  const container = document.getElementById('templatesContainer');
  const createBtn = document.getElementById('createTemplateBtn');
  const modal = document.getElementById('templateModal');
  const modalTitle = document.getElementById('templateModalTitle');
  const modalBody = document.getElementById('templateModalBody');
  const modalCancel = document.getElementById('templateModalCancel');
  const modalSave = document.getElementById('templateModalSave');
  if (!card || !container) return;

  card.style.display = '';

  let departments = [];
  let templates = [];
  let onModalSave = null;

  try {
    [departments, templates] = await Promise.all([
      Api.get('/api/departments'),
      Api.get('/api/templates'),
    ]);
  } catch (e) {
    container.innerHTML = `<div class="msg msg-error">${escapeHtml(e.message)}</div>`;
    return;
  }

  // Separate departments into internal and external for grouped dropdown
  const internalDepts = departments.filter(d => !d.isExternal);
  const externalDepts = departments.filter(d => d.isExternal);

  function buildDeptDropdownOptions(excludeIds) {
    const excluded = new Set(excludeIds || []);
    let opts = '<option value="">+ Add department...</option>';
    if (internalDepts.length > 0) {
      opts += '<optgroup label="Departments">';
      internalDepts.forEach(d => {
        opts += `<option value="${d.id}" ${excluded.has(d.id) ? 'disabled' : ''}>${escapeHtml(d.nameEn || d.name)}</option>`;
      });
      opts += '</optgroup>';
    }
    if (externalDepts.length > 0) {
      opts += '<optgroup label="Agencies">';
      externalDepts.forEach(d => {
        opts += `<option value="${d.id}" ${excluded.has(d.id) ? 'disabled' : ''}>${escapeHtml(d.nameEn || d.name)}</option>`;
      });
      opts += '</optgroup>';
    }
    return opts;
  }

  function initSectionRow(row) {
    const pillsContainer = row.querySelector('.tpl-dept-pills');
    const addSelect = row.querySelector('.tpl-dept-add');

    function addDeptPill(deptId) {
      const d = departments.find(x => x.id === deptId);
      if (!d) return;
      if (row.querySelector(`.tpl-dept-pill[data-dept-id="${deptId}"]`)) return;
      const pill = document.createElement('span');
      pill.className = d.isExternal ? 'pill pill-yellow tpl-dept-pill' : 'pill pill-blue tpl-dept-pill';
      pill.dataset.deptId = deptId;
      pill.style.cssText = 'cursor:pointer;display:inline-flex;align-items:center;gap:4px;font-size:12px;padding:3px 10px;margin:2px;';
      pill.title = 'Click to remove';
      pill.innerHTML = `${escapeHtml(d.nameEn || d.name)} <span style="font-size:14px;line-height:1;opacity:0.6;">\u00d7</span>`;
      pill.addEventListener('click', () => {
        pill.remove();
        const opt = addSelect.querySelector(`option[value="${deptId}"]`);
        if (opt) opt.disabled = false;
        updateCount();
      });
      pillsContainer.appendChild(pill);
    }

    function updateCount() {
      const count = row.querySelectorAll('.tpl-dept-pill').length;
      row.querySelector('.tpl-dept-count').textContent = count + ' dept(s)';
    }

    addSelect.addEventListener('change', () => {
      const deptId = parseInt(addSelect.value);
      if (!deptId) return;
      addDeptPill(deptId);
      addSelect.querySelector(`option[value="${deptId}"]`).disabled = true;
      addSelect.value = '';
      updateCount();
    });

    // Quick-add buttons
    row.querySelector('.tpl-add-all-depts').addEventListener('click', () => {
      internalDepts.forEach(d => {
        addDeptPill(d.id);
        const opt = addSelect.querySelector(`option[value="${d.id}"]`);
        if (opt) opt.disabled = true;
      });
      updateCount();
    });
    row.querySelector('.tpl-add-all-agencies').addEventListener('click', () => {
      externalDepts.forEach(d => {
        addDeptPill(d.id);
        const opt = addSelect.querySelector(`option[value="${d.id}"]`);
        if (opt) opt.disabled = true;
      });
      updateCount();
    });

    return { addDeptPill, updateCount };
  }

  function renderTemplates() {
    if (templates.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No templates yet. Create one to preset sections for your events.</p></div>';
      return;
    }

    container.innerHTML = templates.map(t => {
      const sectionsList = t.sections.map(s => {
        const deptNames = (s.departmentIds || [])
          .map(id => {
            const d = departments.find(d => d.id === id);
            return d ? escapeHtml(d.nameEn || d.name) : '';
          })
          .filter(Boolean)
          .join(', ');
        return `<li style="margin-bottom:4px;">
          <strong>${escapeHtml(s.title)}</strong>
          ${deptNames ? `<span style="color:#666;font-size:12px;"> \u2014 ${deptNames}</span>` : ''}
        </li>`;
      }).join('');

      const badge = t.isDefault
        ? '<span class="pill pill-green" style="margin-left:8px;font-size:11px;">Default</span>'
        : '';

      const deleteBtn = t.isDefault
        ? ''
        : `<button class="btn btn-danger" onclick="deleteTemplate(${t.id})">Delete</button>`;

      return `
        <div class="event-card" style="margin-bottom:12px;">
          <div class="event-card-info">
            <h4>${escapeHtml(t.name)}${badge}</h4>
            <div style="font-size:13px;color:#666;margin-bottom:8px;">
              ${t.sections.length} section(s)${t.createdByName ? ' | By: ' + escapeHtml(t.createdByName) : ''}
            </div>
            <ol style="margin:0 0 0 18px;font-size:13px;">${sectionsList || '<li>No sections</li>'}</ol>
          </div>
          <div class="event-card-actions">
            ${deleteBtn}
          </div>
        </div>
      `;
    }).join('');
  }

  window.deleteTemplate = async function(id) {
    if (!confirm('Delete this template?')) return;
    try {
      await Api.delete(`/api/templates/${id}`);
      templates = templates.filter(t => t.id !== id);
      renderTemplates();
    } catch (e) { alert(e.message); }
  };

  function showTemplateModal(title, bodyHtml, saveLabel, saveFn) {
    modalTitle.textContent = title;
    modalBody.innerHTML = bodyHtml;
    modalSave.textContent = saveLabel || 'Save';
    onModalSave = saveFn;
    modal.style.display = 'flex';
  }

  function hideTemplateModal() { modal.style.display = 'none'; onModalSave = null; }

  modalCancel.addEventListener('click', hideTemplateModal);
  modalSave.addEventListener('click', () => { if (onModalSave) onModalSave(); });

  createBtn.addEventListener('click', () => {
    showTemplateModal('Create Template', `
      <div class="form-group">
        <label class="form-label">Template Name *</label>
        <input class="form-input" id="tplName" placeholder="e.g. My Custom Template" />
      </div>
      <div class="form-group">
        <label class="form-label" style="font-weight:700;">Sections</label>
        <div id="tplSectionRows"></div>
        <button class="btn btn-outline" type="button" id="tplAddSection" style="margin-top:8px;">+ Add Section</button>
      </div>
    `, 'Create', async () => {
      const name = document.getElementById('tplName').value.trim();
      if (!name) { alert('Template name is required'); return; }

      const sections = [];
      document.querySelectorAll('#tplSectionRows .tpl-section-row').forEach((row, i) => {
        const title = row.querySelector('.tpl-sec-title').value.trim();
        const deptIds = Array.from(row.querySelectorAll('.tpl-dept-pill'))
          .map(pill => parseInt(pill.dataset.deptId));
        if (title) sections.push({ title, sortOrder: i, departmentIds: deptIds });
      });

      if (sections.length === 0) { alert('Add at least one section'); return; }

      try {
        await Api.post('/api/templates', { name, sections });
        hideTemplateModal();
        templates = await Api.get('/api/templates');
        renderTemplates();
      } catch (err) { alert(err.message); }
    });

    const rowsContainer = document.getElementById('tplSectionRows');
    const addBtn = document.getElementById('tplAddSection');

    function addSectionRow() {
      const row = document.createElement('div');
      row.className = 'tpl-section-row';
      row.style.cssText = 'border:1px solid var(--border-color,#ddd);border-radius:12px;margin-bottom:10px;overflow:hidden;';
      row.innerHTML = `
        <div class="tpl-sec-header" style="display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;user-select:none;">
          <span class="tpl-sec-toggle" style="font-size:11px;color:#888;transition:transform .2s;">\u25b6</span>
          <input class="form-input tpl-sec-title" placeholder="Section title" style="flex:1;font-weight:600;border:none;padding:0;background:transparent;" onclick="event.stopPropagation()" />
          <span class="tpl-dept-count" style="font-size:12px;color:#666;white-space:nowrap;">0 dept(s)</span>
          <button class="btn btn-outline" type="button" style="padding:2px 8px;font-size:11px;color:#dc2626;" onclick="event.stopPropagation();this.closest('.tpl-section-row').remove()">\u00d7</button>
        </div>
        <div class="tpl-sec-body" style="display:none;padding:8px 14px 14px 14px;border-top:1px solid var(--border-color,#eee);">
          <div class="tpl-dept-pills" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;min-height:8px;"></div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <select class="form-select tpl-dept-add" style="font-size:12px;padding:4px 8px;flex:1;min-width:200px;">
              ${buildDeptDropdownOptions([])}
            </select>
            <button type="button" class="btn btn-outline tpl-add-all-depts" style="padding:3px 10px;font-size:11px;white-space:nowrap;">All Depts</button>
            <button type="button" class="btn btn-outline tpl-add-all-agencies" style="padding:3px 10px;font-size:11px;white-space:nowrap;">All Agencies</button>
          </div>
        </div>
      `;
      rowsContainer.appendChild(row);

      // Expand/collapse
      const header = row.querySelector('.tpl-sec-header');
      const body = row.querySelector('.tpl-sec-body');
      const toggle = row.querySelector('.tpl-sec-toggle');
      header.addEventListener('click', () => {
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : '';
        toggle.style.transform = open ? '' : 'rotate(90deg)';
      });

      initSectionRow(row);

      // Auto-expand new rows
      body.style.display = '';
      toggle.style.transform = 'rotate(90deg)';
    }

    addBtn.addEventListener('click', addSectionRow);
    addSectionRow();
  });

  renderTemplates();
})();
