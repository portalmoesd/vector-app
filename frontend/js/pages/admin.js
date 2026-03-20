/**
 * Admin Panel — Departments, Users, Deputy–Supervisor Links
 */
(async function () {
  await App.init();

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
        loadDepartments();
      } catch (e) { alert(e.message); }
    });
  });

  // ── Users ──────────────────────────────────────────────────────────────────
  let departments = [];

  async function loadUsers() {
    try {
      const users = await Api.get('/api/users');
      if (users.length === 0) {
        document.getElementById('userList').innerHTML = '<div class="empty-state"><p>No users yet</p></div>';
        return;
      }
      document.getElementById('userList').innerHTML = `
        <div class="table-wrap"><table>
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Department</th><th>External</th></tr></thead>
          <tbody>${users.map(u => `
            <tr>
              <td>${escapeHtml(u.fullName)}</td>
              <td>${escapeHtml(u.username)}</td>
              <td><span class="pill pill-blue">${roleLabel(u.role)}</span></td>
              <td>${u.departmentName ? escapeHtml(u.departmentName) : '—'}</td>
              <td>${u.isExternal ? 'Yes' : 'No'}</td>
            </tr>
          `).join('')}</tbody>
        </table></div>`;
    } catch (e) {
      document.getElementById('userList').innerHTML = `<div class="msg msg-error">${escapeHtml(e.message)}</div>`;
    }
  }

  document.getElementById('addUserBtn').addEventListener('click', () => {
    const deptOptions = departments.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
    showModal('Add User', `
      <div class="form-group">
        <label class="form-label">Full Name</label>
        <input class="form-input" id="userFullName" required />
      </div>
      <div class="form-group">
        <label class="form-label">Username</label>
        <input class="form-input" id="userUsername" required />
      </div>
      <div class="form-group">
        <label class="form-label">Email</label>
        <input class="form-input" type="email" id="userEmail" required />
      </div>
      <div class="form-group">
        <label class="form-label">Password</label>
        <input class="form-input" type="password" id="userPassword" required />
      </div>
      <div class="form-group">
        <label class="form-label">Role</label>
        <select class="form-select" id="userRole">
          <option value="COLLABORATOR">Collaborator</option>
          <option value="SUPER_COLLABORATOR">Super-Collaborator</option>
          <option value="SUPERVISOR">Supervisor</option>
          <option value="DEPUTY">Deputy</option>
          <option value="PROTOCOL">Protocol</option>
          <option value="ADMIN">Admin</option>
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
        <label class="form-label"><input type="checkbox" id="userExternal" /> External user</label>
      </div>
    `, async () => {
      const fullName = document.getElementById('userFullName').value.trim();
      const username = document.getElementById('userUsername').value.trim();
      const email = document.getElementById('userEmail').value.trim();
      const password = document.getElementById('userPassword').value;
      const role = document.getElementById('userRole').value;
      const departmentId = document.getElementById('userDept').value || null;
      const isExternal = document.getElementById('userExternal').checked;
      if (!fullName || !username || !email || !password) return;
      try {
        await Api.post('/api/users', { fullName, username, email, password, role, departmentId, isExternal });
        hideModal();
        loadUsers();
      } catch (e) { alert(e.message); }
    });
  });

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

  // ── Init ───────────────────────────────────────────────────────────────────
  departments = await loadDepartments();
  loadUsers();
  loadLinks();
})();
