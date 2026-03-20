/**
 * Section Editor
 * - Loads section content from the API
 * - Provides rich text editing (contenteditable)
 * - Workflow actions: Save, Submit, Approve, Return, Ask to Return
 * - Comments and history panels
 */
(async function () {
  await App.init();

  const user = Api.getUser();
  if (!user) return;

  const params = new URLSearchParams(window.location.search);
  const eventId = parseInt(params.get('event_id'));
  const sectionId = parseInt(params.get('section_id'));

  if (!eventId || !sectionId) {
    document.getElementById('editorContent').innerHTML = '<p>Missing event_id or section_id</p>';
    return;
  }

  const editorContent = document.getElementById('editorContent');
  const actionToolbar = document.getElementById('actionToolbar');
  const sectionMeta = document.getElementById('sectionMeta');
  const editorTitle = document.getElementById('editorTitle');

  // Load section data
  let grid, sectionInfo, content;
  try {
    [grid, content] = await Promise.all([
      Api.get(`/api/workflow/status-grid?event_id=${eventId}`),
      Api.get(`/api/workflow/section-content?event_id=${eventId}&section_id=${sectionId}`),
    ]);
  } catch (e) {
    editorContent.innerHTML = `<div class="msg msg-error">${escapeHtml(e.message)}</div>`;
    return;
  }

  sectionInfo = grid.sections.find(s => s.sectionId === sectionId);
  if (!sectionInfo) {
    editorContent.innerHTML = '<div class="msg msg-error">Section not found in event</div>';
    return;
  }

  // Set title and meta
  editorTitle.textContent = sectionInfo.sectionLabel;
  const status = sectionInfo.status || 'draft';

  // Determine effective role
  const effectiveRole = getEffectiveRole(user, grid);
  const isHolder = sectionInfo.currentHolderRole === effectiveRole;

  sectionMeta.innerHTML = `
    <span>Status: <span class="status ${statusClass(status)}">${statusLabel(status)}</span></span>
    <span>Current holder: ${roleLabel(sectionInfo.currentHolderRole)}</span>
    ${content.lastEditedBy ? `<span>Last edited by: ${escapeHtml(content.lastEditedBy)}</span>` : ''}
  `;

  // Load content
  editorContent.innerHTML = content.htmlContent || '';

  // Enable/disable editing based on whether user is the holder
  const canEdit = isHolder && (status === 'draft' || status.startsWith('returned_'));
  editorContent.contentEditable = canEdit ? 'true' : 'false';

  // Build action toolbar
  buildToolbar(status, effectiveRole, isHolder, canEdit);

  // Load comments and history
  loadComments();
  loadHistory();

  function getEffectiveRole(user, grid) {
    if (user.role === 'DEPUTY' && grid.deputyId === user.id && grid.documentSubmitterId !== user.id) {
      return 'CURATOR';
    }
    return user.role;
  }

  function buildToolbar(status, role, isHolder, canEdit) {
    const btns = [];

    // Save (if can edit)
    if (canEdit) {
      btns.push(`<button id="btnSave" class="primary">
        <span class="icon" style="--icon-url: url(/assets/save-icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url); width:14px;height:14px;display:inline-block;background:currentColor;"></span>
        Save
      </button>`);
    }

    if (isHolder) {
      // Submit (from draft or returned)
      if (status === 'draft' || status.startsWith('returned_')) {
        btns.push(`<button id="btnSubmit" class="primary">
          <span class="icon" style="--icon-url: url(/assets/submit-icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url); width:14px;height:14px;display:inline-block;background:currentColor;"></span>
          Submit
        </button>`);
      }

      // Approve + Return (when submitted to this role)
      if (status === `submitted_to_${role.toLowerCase()}`) {
        btns.push(`<button id="btnApprove" class="success">
          <span class="icon" style="--icon-url: url(/assets/approve-icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url); width:14px;height:14px;display:inline-block;background:currentColor;"></span>
          Approve
        </button>`);
        btns.push(`<button id="btnReturn" class="danger">
          <span class="icon" style="--icon-url: url(/assets/return-icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url); width:14px;height:14px;display:inline-block;background:currentColor;"></span>
          Return
        </button>`);
      }
    }

    // Ask to Return (available when not the holder and workflow started)
    if (!isHolder && status !== 'draft') {
      btns.push(`<button id="btnAskReturn" class="warning">
        <span class="icon" style="--icon-url: url(/assets/ask_to_return_icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url); width:14px;height:14px;display:inline-block;background:currentColor;"></span>
        Ask to Return
      </button>`);
    }

    // Back to dashboard
    btns.push(`<button id="btnBack" style="margin-left: auto;">Back to Dashboard</button>`);

    actionToolbar.innerHTML = btns.join('');

    // Bind events
    const btnSave = document.getElementById('btnSave');
    const btnSubmit = document.getElementById('btnSubmit');
    const btnApprove = document.getElementById('btnApprove');
    const btnReturn = document.getElementById('btnReturn');
    const btnAskReturn = document.getElementById('btnAskReturn');
    const btnBack = document.getElementById('btnBack');

    if (btnSave) btnSave.addEventListener('click', handleSave);
    if (btnSubmit) btnSubmit.addEventListener('click', handleSubmit);
    if (btnApprove) btnApprove.addEventListener('click', handleApprove);
    if (btnReturn) btnReturn.addEventListener('click', handleReturn);
    if (btnAskReturn) btnAskReturn.addEventListener('click', handleAskReturn);
    if (btnBack) btnBack.addEventListener('click', () => {
      window.location.href = dashboardUrl(user.role);
    });
  }

  async function handleSave() {
    try {
      await Api.post('/api/workflow/save', {
        eventId, sectionId,
        htmlContent: editorContent.innerHTML,
      });
      showNotification('Saved successfully');
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
  }

  async function handleSubmit() {
    if (!confirm('Submit this section to the next reviewer?')) return;
    try {
      // Save first
      await Api.post('/api/workflow/save', {
        eventId, sectionId,
        htmlContent: editorContent.innerHTML,
      });
      const result = await Api.post('/api/workflow/submit', { eventId, sectionId });
      showNotification('Submitted successfully');
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      alert('Submit failed: ' + e.message);
    }
  }

  async function handleApprove() {
    const comment = prompt('Optional approval comment:');
    try {
      await Api.post('/api/workflow/approve', {
        eventId, sectionId, comment: comment || undefined,
      });
      showNotification('Approved successfully');
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      alert('Approve failed: ' + e.message);
    }
  }

  async function handleReturn() {
    const comment = prompt('Return comment (required):');
    if (!comment) return;
    try {
      await Api.post('/api/workflow/return', { eventId, sectionId, comment });
      showNotification('Returned successfully');
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      alert('Return failed: ' + e.message);
    }
  }

  async function handleAskReturn() {
    const note = prompt('Reason for return request:');
    if (!note) return;
    try {
      await Api.post('/api/workflow/ask-to-return', { eventId, sectionId, note });
      showNotification('Return request sent');
    } catch (e) {
      alert('Request failed: ' + e.message);
    }
  }

  function showNotification(msg) {
    const el = document.createElement('div');
    el.className = 'msg msg-success';
    el.textContent = msg;
    el.style.cssText = 'position:fixed;top:16px;right:16px;z-index:999;padding:12px 20px;border-radius:6px;';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  // ─── Comments ────────────────────────────────────────────────────────────────

  async function loadComments() {
    try {
      const comments = await Api.get(`/api/workflow/comments?event_id=${eventId}&section_id=${sectionId}`);
      const list = document.getElementById('commentsList');
      if (!comments || comments.length === 0) {
        list.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">No comments yet</p>';
        return;
      }
      list.innerHTML = comments.map(c => `
        <div class="comment-card">
          <div class="comment-meta">${escapeHtml(c.userName || 'User')} — ${formatDateTime(c.createdAt)}</div>
          <div>${escapeHtml(c.content)}</div>
        </div>
      `).join('');
    } catch (e) {
      console.error('Load comments error:', e);
    }
  }

  document.getElementById('addCommentBtn').addEventListener('click', async () => {
    const input = document.getElementById('commentInput');
    const text = input.value.trim();
    if (!text) return;
    try {
      await Api.post('/api/workflow/comments', { eventId, sectionId, content: text });
      input.value = '';
      loadComments();
    } catch (e) {
      alert('Failed to add comment: ' + e.message);
    }
  });

  // ─── History ─────────────────────────────────────────────────────────────────

  async function loadHistory() {
    try {
      const history = await Api.get(`/api/workflow/section-history?event_id=${eventId}&section_id=${sectionId}`);
      const list = document.getElementById('historyList');
      if (!history || history.length === 0) {
        list.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">No history yet</p>';
        return;
      }
      list.innerHTML = history.map(h => `
        <div class="history-entry">
          <span class="time">${formatDateTime(h.actedAt)}</span>
          <span class="action">${escapeHtml(h.action)}</span>
          <span>${escapeHtml(h.userName || '')} (${roleLabel(h.userRole || '')})</span>
          ${h.note ? `<span style="color: var(--text-muted);">— ${escapeHtml(h.note)}</span>` : ''}
        </div>
      `).join('');
    } catch (e) {
      console.error('Load history error:', e);
    }
  }
})();
