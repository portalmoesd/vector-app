/**
 * Deputy Templates — manage preset section templates.
 * Deputies can create templates with named sections and department assignments.
 * These templates auto-fill sections when Protocol/Admin creates events.
 */
(async function () {
  const user = Api.getUser();
  if (!user || user.role !== 'DEPUTY') return;

  let departments = [];
  let templates = [];

  const container = document.getElementById('templatesContainer');
  const createBtn = document.getElementById('createTemplateBtn');
  const modal = document.getElementById('templateModal');
  const modalTitle = document.getElementById('templateModalTitle');
  const modalBody = document.getElementById('templateModalBody');
  const modalCancel = document.getElementById('templateModalCancel');
  const modalSave = document.getElementById('templateModalSave');
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

  function renderTemplates() {
    if (templates.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No templates yet. Create one to preset sections for your events.</p></div>';
      return;
    }

    container.innerHTML = templates.map(t => {
      const sectionsList = t.sections.map((s, i) => {
        const deptNames = (s.departmentIds || [])
          .map(id => {
            const d = departments.find(d => d.id === id);
            return d ? escapeHtml(d.nameEn || d.name) : '';
          })
          .filter(Boolean)
          .join(', ');
        return `<li style="margin-bottom:4px;">
          <strong>${escapeHtml(s.title)}</strong>
          ${deptNames ? `<span style="color:#666;font-size:12px;"> — ${deptNames}</span>` : ''}
        </li>`;
      }).join('');

      return `
        <div class="event-card" style="margin-bottom:12px;">
          <div class="event-card-info">
            <h4>${escapeHtml(t.name)}</h4>
            <div style="font-size:13px;color:#666;margin-bottom:8px;">
              DS Role: ${roleLabel(t.documentSubmitterRole)} | Curator: ${t.curatorRequired ? 'Yes' : 'No'} | ${t.sections.length} section(s)
            </div>
            <ol style="margin:0 0 0 18px;font-size:13px;">${sectionsList || '<li>No sections</li>'}</ol>
          </div>
          <div class="event-card-actions">
            <button class="btn btn-danger" onclick="deleteTemplate(${t.id})">Delete</button>
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

  // Modal helpers
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

  // Create template
  createBtn.addEventListener('click', () => {
    const deptOpts = departments.map(d =>
      `<option value="${d.id}">${escapeHtml(d.nameEn || d.name)}</option>`
    ).join('');

    showTemplateModal('Create Template', `
      <div class="form-group">
        <label class="form-label">Template Name *</label>
        <input class="form-input" id="tplName" placeholder="e.g. Standard Review Template" />
      </div>
      <div class="form-group">
        <label class="form-label">Document Submitter Role</label>
        <select class="form-select" id="tplDSRole">
          <option value="DEPUTY">Deputy</option>
          <option value="SUPERVISOR">Supervisor</option>
          <option value="SUPER_COLLABORATOR">Super-Collaborator</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label"><input type="checkbox" id="tplCurator" /> Curator Required</label>
      </div>
      <div class="form-group">
        <label class="form-label" style="font-weight:700;">Sections</label>
        <div id="tplSectionRows"></div>
        <button class="btn btn-outline" type="button" id="tplAddSection" style="margin-top:8px;">+ Add Section</button>
      </div>
    `, 'Create', async () => {
      const name = document.getElementById('tplName').value.trim();
      const documentSubmitterRole = document.getElementById('tplDSRole').value;
      const curatorRequired = document.getElementById('tplCurator').checked;

      if (!name) { alert('Template name is required'); return; }

      const sections = [];
      document.querySelectorAll('#tplSectionRows .tpl-section-row').forEach((row, i) => {
        const title = row.querySelector('.tpl-sec-title').value.trim();
        const deptIds = Array.from(row.querySelectorAll('.tpl-sec-dept:checked'))
          .map(cb => parseInt(cb.dataset.deptId));
        if (title) sections.push({ title, sortOrder: i, departmentIds: deptIds });
      });

      if (sections.length === 0) { alert('Add at least one section'); return; }

      try {
        await Api.post('/api/templates', { name, documentSubmitterRole, curatorRequired, sections });
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
      row.style.cssText = 'border:1px solid var(--border-color,#ddd);border-radius:8px;padding:12px;margin-bottom:10px;';
      row.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
          <input class="form-input tpl-sec-title" placeholder="Section title" style="flex:1;font-weight:600;" />
          <button class="btn btn-outline" type="button" style="padding:4px 10px;font-size:12px;color:#dc2626;" onclick="this.closest('.tpl-section-row').remove()">\u2715</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${departments.map(d => `
            <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;">
              <input type="checkbox" class="tpl-sec-dept" data-dept-id="${d.id}" />
              ${escapeHtml(d.nameEn || d.name)}
            </label>
          `).join('')}
        </div>
      `;
      rowsContainer.appendChild(row);
    }

    addBtn.addEventListener('click', addSectionRow);
    addSectionRow(); // Start with one row
  });

  renderTemplates();
})();
