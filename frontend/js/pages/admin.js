/**
 * Admin Panel — Departments, Users, Deputy–Supervisor Links
 * Features: CRUD, country assignment with region-based checkboxes, user editing
 */
(async function () {
  await App.init();

  // ── Region definitions (UI-only groupings per §3.4) ─────────────────────────
  const REGIONS = {
    'Neighbors': ['BY','UA','MD','RU','AZ','AM','KZ','TJ','KG','UZ','TM'],
    'EU': ['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'],
    'Other Europe': ['AL','AD','BA','CH','IS','LI','MC','ME','MK','NO','RS','SM','TR','GB','VA','GE','XK'],
    'North America': ['US','CA','MX','GL','BM'],
    'Central America & Caribbean': ['BZ','CR','SV','GT','HN','NI','PA','AG','BS','BB','CU','DM','DO','GD','HT','JM','KN','LC','VC','TT','PR'],
    'South America': ['AR','BO','BR','CL','CO','EC','GY','PY','PE','SR','UY','VE','FK','GF'],
    'Africa': ['DZ','AO','BJ','BW','BF','BI','CV','CM','CF','TD','KM','CG','CD','CI','DJ','EG','GQ','ER','SZ','ET','GA','GM','GH','GN','GW','KE','LS','LR','LY','MG','MW','ML','MR','MU','MA','MZ','NA','NE','NG','RW','ST','SN','SC','SL','SO','ZA','SS','SD','TZ','TG','TN','UG','ZM','ZW'],
    'Asia': ['AF','BH','BD','BT','BN','KH','CN','IN','ID','IR','IQ','IL','JP','JO','KW','LA','LB','MY','MV','MN','MM','NP','KP','OM','PK','PH','QA','SA','SG','KR','LK','SY','TW','TH','TL','AE','VN','YE'],
    'Oceania': ['AU','NZ','FJ','FM','KI','MH','NR','PW','PG','WS','SB','TO','TV','VU'],
  };

  // ── Tab switching ──────────────────────────────────────────────────────────
  document.querySelectorAll('.admin-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.admin-panel').forEach(p => p.style.display = 'none');
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).style.display = '';
    });
  });

  // ── Modal helpers ──────────────────────────────────────────────────────────
  const modal = document.getElementById('modal');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const modalCancel = document.getElementById('modalCancel');
  const modalSave = document.getElementById('modalSave');
  let onSave = null;

  function showModal(title, bodyHtml, saveFn) {
    modalTitle.textContent = title;
    modalBody.innerHTML = bodyHtml;
    onSave = saveFn;
    modal.style.display = 'flex';
  }

  function hideModal() {
    modal.style.display = 'none';
    onSave = null;
  }

  modalCancel.addEventListener('click', hideModal);
  modalSave.addEventListener('click', () => { if (onSave) onSave(); });

  // ── Shared data ─────────────────────────────────────────────────────────────
  let departments = [];
  let allCountries = [];

  // Load countries once
  try { allCountries = await Api.get('/api/countries'); } catch(e) { console.error(e); }

  // ── Country picker HTML generation ──────────────────────────────────────────

  function buildCountryPickerHtml(selectedIds) {
    const selected = new Set(selectedIds || []);
    let html = '<div class="country-picker" style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:12px;margin-top:8px;">';

    for (const [region, codes] of Object.entries(REGIONS)) {
      const countriesInRegion = allCountries.filter(c => codes.includes(c.code));
      if (countriesInRegion.length === 0) continue;

      const allChecked = countriesInRegion.every(c => selected.has(c.id));
      const someChecked = countriesInRegion.some(c => selected.has(c.id));

      html += `<div class="region-group" style="margin-bottom:8px;">
        <label style="font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;padding:4px 0;">
          <input type="checkbox" class="region-toggle" data-region="${region}"
            ${allChecked ? 'checked' : ''} ${someChecked && !allChecked ? 'indeterminate' : ''} />
          ${escapeHtml(region)} (${countriesInRegion.length})
        </label>
        <div class="region-countries" style="display:none;padding-left:20px;columns:2;column-gap:12px;">
          ${countriesInRegion.map(c => `
            <label style="display:flex;align-items:center;gap:4px;padding:1px 0;font-size:13px;break-inside:avoid;cursor:pointer;">
              <input type="checkbox" class="country-cb" data-country-id="${c.id}" data-region="${region}"
                ${selected.has(c.id) ? 'checked' : ''} />
              ${escapeHtml(c.name_en || c.nameEn || c.name)}
            </label>
          `).join('')}
        </div>
      </div>`;
    }

    html += '</div>';
    return html;
  }

  function initCountryPicker(container) {
    // Toggle region expand
    container.querySelectorAll('.region-group > label').forEach(label => {
      label.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        const countries = label.nextElementSibling;
        countries.style.display = countries.style.display === 'none' ? '' : 'none';
      });
    });

    // Region toggle all
    container.querySelectorAll('.region-toggle').forEach(toggle => {
      toggle.addEventListener('change', () => {
        const region = toggle.dataset.region;
        container.querySelectorAll(`.country-cb[data-region="${region}"]`).forEach(cb => {
          cb.checked = toggle.checked;
        });
      });
    });

    // Country checkbox updates region state
    container.querySelectorAll('.country-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        const region = cb.dataset.region;
        const cbs = container.querySelectorAll(`.country-cb[data-region="${region}"]`);
        const toggle = container.querySelector(`.region-toggle[data-region="${region}"]`);
        const checkedCount = Array.from(cbs).filter(c => c.checked).length;
        toggle.checked = checkedCount === cbs.length;
        toggle.indeterminate = checkedCount > 0 && checkedCount < cbs.length;
      });
    });
  }

  function getSelectedCountryIds(container) {
    return Array.from(container.querySelectorAll('.country-cb:checked'))
      .map(cb => parseInt(cb.dataset.countryId));
  }

  // ── Departments ────────────────────────────────────────────────────────────
  async function loadDepartments() {
    try {
      const depts = await Api.get('/api/departments');
      if (depts.length === 0) {
        document.getElementById('deptList').innerHTML = '<div class="empty-state"><p>No departments yet</p></div>';
        return depts;
      }
      document.getElementById('deptList').innerHTML = `
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Name (KA)</th><th>Name (EN)</th><th>Type</th></tr></thead>
          <tbody>${depts.map((d, i) => `
            <tr><td>${i + 1}</td><td>${escapeHtml(d.name)}</td><td>${d.nameEn ? escapeHtml(d.nameEn) : '—'}</td><td><span class="pill ${d.isExternal ? 'pill-yellow' : 'pill-blue'}">${d.isExternal ? 'Agency' : 'Department'}</span></td></tr>
          `).join('')}</tbody>
        </table></div>`;
      return depts;
    } catch (e) {
      document.getElementById('deptList').innerHTML = `<div class="msg msg-error">${escapeHtml(e.message)}</div>`;
      return [];
    }
  }

  document.getElementById('addDeptBtn').addEventListener('click', () => {
    showModal('Add Department', `
      <div class="form-group">
        <label class="form-label">Name</label>
        <input class="form-input" id="deptName" required />
      </div>
      <div class="form-group">
        <label class="form-label"><input type="checkbox" id="deptExternal" /> External organization</label>
      </div>
    `, async () => {
      const name = document.getElementById('deptName').value.trim();
      if (!name) return;
      try {
        await Api.post('/api/departments', { name, isExternal: document.getElementById('deptExternal').checked });
        hideModal();
        departments = await loadDepartments();
      } catch (e) { alert(e.message); }
    });
  });

  // ── Users ──────────────────────────────────────────────────────────────────
  async function loadUsers() {
    try {
      const users = await Api.get('/api/users');
      if (users.length === 0) {
        document.getElementById('userList').innerHTML = '<div class="empty-state"><p>No users yet</p></div>';
        return;
      }
      document.getElementById('userList').innerHTML = `
        <div class="table-wrap"><table>
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Department</th><th>External</th><th>Actions</th></tr></thead>
          <tbody>${users.map(u => `
            <tr>
              <td>${escapeHtml(u.fullName)}</td>
              <td>${escapeHtml(u.username)}</td>
              <td><span class="pill pill-blue">${roleLabel(u.role)}</span></td>
              <td>${u.departmentName ? escapeHtml(u.departmentName) : '—'}</td>
              <td>${u.isExternal ? 'Yes' : 'No'}</td>
              <td>
                <button class="btn btn-outline" style="padding:4px 10px;font-size:12px;" onclick="editUser(${u.id})">Edit</button>
              </td>
            </tr>
          `).join('')}</tbody>
        </table></div>`;
    } catch (e) {
      document.getElementById('userList').innerHTML = `<div class="msg msg-error">${escapeHtml(e.message)}</div>`;
    }
  }

  function userFormHtml(deptOptions, user) {
    const isEdit = !!user;
    const needsCountries = !user || user.role === 'COLLABORATOR' || user.role === 'SUPER_COLLABORATOR';

    return `
      <div class="form-group">
        <label class="form-label">Full Name</label>
        <input class="form-input" id="userFullName" value="${isEdit ? escapeHtml(user.fullName) : ''}" required />
      </div>
      ${!isEdit ? `<div class="form-group">
        <label class="form-label">Username</label>
        <input class="form-input" id="userUsername" required />
      </div>` : ''}
      <div class="form-group">
        <label class="form-label">Email</label>
        <input class="form-input" type="email" id="userEmail" value="${isEdit ? escapeHtml(user.email) : ''}" required />
      </div>
      <div class="form-group">
        <label class="form-label">${isEdit ? 'New Password (leave blank to keep current)' : 'Password'}</label>
        <input class="form-input" type="password" id="userPassword" ${!isEdit ? 'required' : ''} />
      </div>
      <div class="form-group">
        <label class="form-label">Role</label>
        <select class="form-select" id="userRole">
          ${['COLLABORATOR','SUPER_COLLABORATOR','SUPERVISOR','DEPUTY','PROTOCOL','ADMIN'].map(r =>
            `<option value="${r}" ${isEdit && user.role === r ? 'selected' : ''}>${roleLabel(r)}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Department</label>
        <select class="form-select" id="userDept">
          <option value="">— None —</option>
          ${deptOptions}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label"><input type="checkbox" id="userExternal" ${isEdit && user.isExternal ? 'checked' : ''} /> External user</label>
      </div>
      <div class="form-group" id="countryAssignmentGroup" style="${needsCountries ? '' : 'display:none;'}">
        <label class="form-label">Country Assignments</label>
        <div id="countryPickerContainer"></div>
      </div>
    `;
  }

  document.getElementById('addUserBtn').addEventListener('click', () => {
    const deptOptions = departments.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
    showModal('Add User', userFormHtml(deptOptions, null), async () => {
      const fullName = document.getElementById('userFullName').value.trim();
      const username = document.getElementById('userUsername').value.trim();
      const email = document.getElementById('userEmail').value.trim();
      const password = document.getElementById('userPassword').value;
      const role = document.getElementById('userRole').value;
      const departmentId = document.getElementById('userDept').value || null;
      const isExternal = document.getElementById('userExternal').checked;
      const countryIds = getSelectedCountryIds(document.getElementById('countryPickerContainer'));
      if (!fullName || !username || !email || !password) return;
      try {
        await Api.post('/api/users', { fullName, username, email, password, role, departmentId, isExternal, countryIds });
        hideModal();
        loadUsers();
      } catch (e) { alert(e.message); }
    });

    // Render country picker
    const container = document.getElementById('countryPickerContainer');
    container.innerHTML = buildCountryPickerHtml([]);
    initCountryPicker(container);

    // Show/hide country picker based on role
    document.getElementById('userRole').addEventListener('change', () => {
      const role = document.getElementById('userRole').value;
      const show = role === 'COLLABORATOR' || role === 'SUPER_COLLABORATOR';
      document.getElementById('countryAssignmentGroup').style.display = show ? '' : 'none';
    });
  });

  // Edit user
  window.editUser = async function(userId) {
    const users = await Api.get('/api/users');
    const user = users.find(u => u.id === userId);
    if (!user) return;

    // Load user's country assignments
    let userCountries = [];
    try { userCountries = await Api.get(`/api/users/${userId}/countries`); } catch(e) { /* ok */ }
    const selectedCountryIds = userCountries.map(c => c.id);

    const deptOptions = departments.map(d =>
      `<option value="${d.id}" ${user.departmentId === d.id ? 'selected' : ''}>${escapeHtml(d.name)}</option>`
    ).join('');

    showModal('Edit User — ' + user.fullName, userFormHtml(deptOptions, user), async () => {
      const fullName = document.getElementById('userFullName').value.trim();
      const email = document.getElementById('userEmail').value.trim();
      const password = document.getElementById('userPassword').value;
      const role = document.getElementById('userRole').value;
      const departmentId = document.getElementById('userDept').value || null;
      const isExternal = document.getElementById('userExternal').checked;
      const countryIds = getSelectedCountryIds(document.getElementById('countryPickerContainer'));
      if (!fullName || !email) return;

      const body = { fullName, email, role, departmentId, isExternal, countryIds };
      if (password) body.password = password;

      try {
        await Api.patch(`/api/users/${userId}`, body);
        hideModal();
        loadUsers();
      } catch (e) { alert(e.message); }
    });

    // Set department select value
    const deptSelect = document.getElementById('userDept');
    if (deptSelect && user.departmentId) deptSelect.value = user.departmentId;

    // Render country picker with existing assignments
    const container = document.getElementById('countryPickerContainer');
    container.innerHTML = buildCountryPickerHtml(selectedCountryIds);
    initCountryPicker(container);

    // Show/hide country picker based on role
    const roleSelect = document.getElementById('userRole');
    roleSelect.addEventListener('change', () => {
      const role = roleSelect.value;
      const show = role === 'COLLABORATOR' || role === 'SUPER_COLLABORATOR';
      document.getElementById('countryAssignmentGroup').style.display = show ? '' : 'none';
    });
  };

  // ── Deputy–Supervisor Links ────────────────────────────────────────────────
  let allUsers = [];

  async function loadLinks() {
    try {
      const links = await Api.get('/api/admin/deputy-supervisor-links');
      if (links.length === 0) {
        document.getElementById('linksList').innerHTML = '<div class="empty-state"><p>No links defined yet</p></div>';
        return;
      }
      document.getElementById('linksList').innerHTML = `
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Deputy</th><th>Supervisor</th><th>Department</th><th>Actions</th></tr></thead>
          <tbody>${links.map((l, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${escapeHtml(l.deputyName)}</td>
              <td>${escapeHtml(l.supervisorName)}</td>
              <td>${l.supervisorDepartment ? escapeHtml(l.supervisorDepartment) : '—'}</td>
              <td>
                <button class="btn btn-danger" style="padding:4px 10px;font-size:12px;" onclick="deleteLink(${l.id})">Delete</button>
              </td>
            </tr>
          `).join('')}</tbody>
        </table></div>`;
    } catch (e) {
      document.getElementById('linksList').innerHTML = `<div class="msg msg-error">${escapeHtml(e.message)}</div>`;
    }
  }

  // Expose deleteLink globally
  window.deleteLink = async function(id) {
    if (!confirm('Remove this link?')) return;
    try {
      await Api.delete(`/api/admin/deputy-supervisor-links/${id}`);
      loadLinks();
    } catch (e) { alert(e.message); }
  };

  document.getElementById('addLinkBtn').addEventListener('click', async () => {
    // Fetch users for dropdowns
    if (allUsers.length === 0) {
      try { allUsers = await Api.get('/api/users'); } catch(e) { alert(e.message); return; }
    }
    const deputies = allUsers.filter(u => u.role === 'DEPUTY');
    const supervisors = allUsers.filter(u => u.role === 'SUPERVISOR');

    const deputyOptions = deputies.map(d => `<option value="${d.id}">${escapeHtml(d.fullName)}</option>`).join('');
    const supervisorOptions = supervisors.map(s => `<option value="${s.id}">${escapeHtml(s.fullName)} (${s.departmentName || '—'})</option>`).join('');

    showModal('Add Deputy–Supervisor Link', `
      <div class="form-group">
        <label class="form-label">Deputy</label>
        <select class="form-select" id="linkDeputy">
          <option value="">— Select Deputy —</option>
          ${deputyOptions}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Supervisor</label>
        <select class="form-select" id="linkSupervisor">
          <option value="">— Select Supervisor —</option>
          ${supervisorOptions}
        </select>
      </div>
    `, async () => {
      const deputyId = parseInt(document.getElementById('linkDeputy').value);
      const supervisorId = parseInt(document.getElementById('linkSupervisor').value);
      if (!deputyId || !supervisorId) return;
      try {
        await Api.post('/api/admin/deputy-supervisor-links', { deputyId, supervisorId });
        hideModal();
        loadLinks();
      } catch (e) { alert(e.message); }
    });
  });

  // ── Department Hierarchy ──────────────────────────────────────────────────
  async function loadHierarchy() {
    try {
      const data = await Api.get('/api/admin/department-hierarchy');
      if (data.length === 0) {
        document.getElementById('hierarchyList').innerHTML = '<div class="empty-state"><p>No departments with assigned users</p></div>';
        return;
      }
      document.getElementById('hierarchyList').innerHTML = data.map(dept => {
        const deputyBadges = dept.deputies.length > 0
          ? dept.deputies.map(d => `<span class="pill pill-purple" style="font-size:11px;">${escapeHtml(d)}</span>`).join(' ')
          : '<span style="color:var(--text-muted);font-size:12px;">No deputy linked</span>';

        const renderUsers = (users, pillClass) => users.length > 0
          ? users.map(u => `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;">
              <span class="pill ${pillClass}" style="font-size:11px;">${escapeHtml(u.fullName)}</span>
              <span style="font-size:11px;color:var(--text-muted);">${escapeHtml(u.email)}</span>
            </div>`).join('')
          : '<span style="color:var(--text-muted);font-size:12px;padding-left:4px;">— None —</span>';

        return `<div class="dept-hierarchy-card" style="border:1px solid var(--border-color);border-radius:12px;padding:18px 20px;margin-bottom:14px;background:var(--bg-card);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
            <h4 style="margin:0;font-size:0.95rem;">${escapeHtml(dept.departmentNameEn || dept.departmentName)}</h4>
            ${dept.isExternal ? '<span class="pill pill-yellow" style="font-size:11px;">Agency</span>' : ''}
          </div>
          <div style="margin-bottom:10px;">
            <div style="font-size:0.75rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Deputy</div>
            <div style="padding-left:4px;">${deputyBadges}</div>
          </div>
          <div style="margin-bottom:10px;">
            <div style="font-size:0.75rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Supervisors</div>
            ${renderUsers(dept.supervisors, 'pill-blue')}
          </div>
          <div style="margin-bottom:10px;">
            <div style="font-size:0.75rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Super-Collaborators</div>
            ${renderUsers(dept.superCollaborators, 'pill-green')}
          </div>
          <div>
            <div style="font-size:0.75rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Collaborators</div>
            ${renderUsers(dept.collaborators, 'pill-blue')}
          </div>
        </div>`;
      }).join('');
    } catch (e) {
      document.getElementById('hierarchyList').innerHTML = `<div class="msg msg-error">${escapeHtml(e.message)}</div>`;
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  departments = await loadDepartments();
  loadUsers();
  loadLinks();
  loadHierarchy();
})();
