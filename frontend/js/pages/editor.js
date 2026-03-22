/**
 * Section Editor — uses GCP.RichEditor for content editing.
 * Workflow actions: Save, Submit, Approve, Return, Ask to Return
 * Comments and history panels below.
 */
(async function () {
  await App.init();

  const user = Api.getUser();
  if (!user) return;

  const params = new URLSearchParams(window.location.search);
  const eventId = parseInt(params.get('event_id'));
  const sectionId = parseInt(params.get('section_id'));

  if (!eventId || !sectionId) {
    document.getElementById('richEditorContainer').innerHTML =
      '<div class="msg msg-error" style="margin:24px;">Missing event_id or section_id</div>';
    return;
  }

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
    document.getElementById('richEditorContainer').innerHTML =
      `<div class="msg msg-error" style="margin:24px;">${escapeHtml(e.message)}</div>`;
    return;
  }

  sectionInfo = grid.sections.find(s => s.sectionId === sectionId);
  if (!sectionInfo) {
    document.getElementById('richEditorContainer').innerHTML =
      '<div class="msg msg-error" style="margin:24px;">Section not found in event</div>';
    return;
  }

  // Set title and meta
  editorTitle.textContent = sectionInfo.sectionLabel;
  const status = sectionInfo.status || 'draft';

  // Determine effective role (per-section from API)
  const effectiveRole = sectionInfo.userEffectiveRole || user.role;
  const isHolder = sectionInfo.currentHolderRole === effectiveRole;

  sectionMeta.innerHTML = `
    <span class="status-pill ${statusClass(status)}">Status: ${statusLabel(status)}</span>
    ${content.lastEditedBy ? `<span>Last edited by: ${escapeHtml(content.lastEditedBy)}</span>` : ''}
  `;

  // Enable editing if the user is the current holder of the section
  const canEdit = isHolder;

  // ── Initialize GCP.RichEditor ──────────────────────────────────────────────

  const richEditor = GCP.RichEditor({
    container: document.getElementById('richEditorContainer'),
    initialHtml: content.htmlContent || '',
    authorName: user.fullName || user.username,
    sectionTitle: sectionInfo.sectionLabel,
    readOnly: !canEdit,
    onCommentsClick(anchorId) {
      // anchorId is set when user selects text and adds a comment via context menu
      if (anchorId) {
        const text = prompt('Enter your comment:');
        if (text && text.trim()) {
          Api.post('/api/workflow/comments', {
            eventId, sectionId, content: text.trim(), anchorId,
            htmlContent: richEditor.getHtml(),
          }).then(() => loadComments()).catch(e => alert('Failed: ' + e.message));
        } else {
          // Cancel — remove the anchor
          richEditor.removeCommentAnchor(anchorId);
        }
      }
    },
    async onDeleteComment(commentId, anchorId) {
      try {
        await Api.post('/api/workflow/comments/delete', { commentId });
        if (anchorId) {
          richEditor.removeCommentAnchor(anchorId);
          // Persist the HTML without the anchor so the highlight doesn't return on reload
          Api.post('/api/workflow/save', {
            eventId, sectionId,
            htmlContent: richEditor.getHtml(),
          }).catch(e => console.error('Auto-save after anchor removal failed:', e));
        }
        loadComments();
      } catch (e) { console.error('Delete comment failed:', e); }
    },
    async onReplyComment(parentId, text) {
      try {
        await Api.post('/api/workflow/comments', {
          eventId, sectionId, content: text, parentId,
        });
        loadComments();
      } catch (e) { alert('Reply failed: ' + e.message); }
    },
  });

  // Build action toolbar
  buildToolbar(status, effectiveRole, isHolder, canEdit);

  // Load comments (for editor margin balloons) and history
  loadComments();
  loadHistory();

  function buildToolbar(status, role, isHolder, canEdit) {
    const leftBtns = [];
    const rightBtns = [];

    // Left side: Back to Dashboard + All Sections
    leftBtns.push(`<button id="btnBack" class="tb-outline">Back to Dashboard</button>`);
    leftBtns.push(`<button id="btnViewAll" class="tb-outline" onclick="window.location.href='/pages/editor-all.html?event_id=${eventId}'">All Sections</button>`);

    // Right side: action buttons

    // File upload button
    rightBtns.push(`<button id="btnUpload" class="tb-outline">
      <span class="icon" style="--icon-url: url(/assets/upload-icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url); width:14px;height:14px;display:inline-block;background:currentColor;"></span>
      Files
    </button>`);

    // Save (if can edit)
    if (canEdit) {
      rightBtns.push(`<button id="btnSave" class="tb-outline tb-outline--blue">
        <span class="icon" style="--icon-url: url(/assets/save-icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url); width:14px;height:14px;display:inline-block;background:currentColor;"></span>
        Save
      </button>`);
    }

    if (isHolder) {
      // Submit (from draft or returned)
      if (status === 'draft' || status.startsWith('returned_')) {
        rightBtns.push(`<button id="btnSubmit" class="tb-outline tb-outline--blue">
          <span class="icon" style="--icon-url: url(/assets/submit-icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url); width:14px;height:14px;display:inline-block;background:currentColor;"></span>
          Submit
        </button>`);
      }

      // Approve + Return (when submitted to this role)
      if (status === `submitted_to_${role.toLowerCase()}`) {
        rightBtns.push(`<button id="btnApprove" class="tb-outline tb-outline--green">
          <span class="icon" style="--icon-url: url(/assets/approve-icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url); width:14px;height:14px;display:inline-block;background:currentColor;"></span>
          Approve
        </button>`);
        rightBtns.push(`<button id="btnReturn" class="tb-outline tb-outline--red">
          <span class="icon" style="--icon-url: url(/assets/return-icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url); width:14px;height:14px;display:inline-block;background:currentColor;"></span>
          Return
        </button>`);
      }
    }

    // Ask to Return (only if user is in the chain and section has passed their step)
    if (!isHolder && status !== 'draft') {
      const chain = sectionInfo.chain || [];
      const userIdx = chain.indexOf(role);
      const holderIdx = chain.indexOf(sectionInfo.currentHolderRole);
      if (userIdx !== -1 && holderIdx > userIdx) {
        rightBtns.push(`<button id="btnAskReturn" class="tb-outline tb-outline--orange">
          <span class="icon" style="--icon-url: url(/assets/ask_to_return_icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url); width:14px;height:14px;display:inline-block;background:currentColor;"></span>
          Ask to Return
        </button>`);
      }
    }

    // Push Section — shown for both holders and non-holders when canPush is true
    if (sectionInfo.canPush) {
      rightBtns.push(`<button id="btnPushSection" class="tb-outline tb-outline--orange">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
        Push Section
      </button>`);
    }

    // Pull Section — pull from a user earlier in the chain
    if (sectionInfo.canPull) {
      rightBtns.push(`<button id="btnPullSection" class="tb-outline tb-outline--purple">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
        Pull Section
      </button>`);
    }

    actionToolbar.innerHTML = leftBtns.join('') + '<span class="tb-spacer"></span>' + rightBtns.join('');

    // Bind events
    const btnSave = document.getElementById('btnSave');
    const btnSubmit = document.getElementById('btnSubmit');
    const btnApprove = document.getElementById('btnApprove');
    const btnReturn = document.getElementById('btnReturn');
    const btnAskReturn = document.getElementById('btnAskReturn');
    const btnPushSection = document.getElementById('btnPushSection');
    const btnPullSection = document.getElementById('btnPullSection');
    const btnBack = document.getElementById('btnBack');

    if (btnSave) btnSave.addEventListener('click', handleSave);
    if (btnSubmit) btnSubmit.addEventListener('click', handleSubmit);
    if (btnApprove) btnApprove.addEventListener('click', handleApprove);
    if (btnReturn) btnReturn.addEventListener('click', handleReturn);
    if (btnAskReturn) btnAskReturn.addEventListener('click', handleAskReturn);
    if (btnPushSection) btnPushSection.addEventListener('click', handlePushSection);
    if (btnPullSection) btnPullSection.addEventListener('click', handlePullSection);
    const btnUpload = document.getElementById('btnUpload');
    if (btnUpload) btnUpload.addEventListener('click', handleFiles);
    if (btnBack) btnBack.addEventListener('click', () => {
      window.location.href = dashboardUrl(user.role);
    });
  }

  // ── Workflow actions (use richEditor.getHtml() instead of contentEditable) ──

  async function handleSave() {
    try {
      await Api.post('/api/workflow/save', {
        eventId, sectionId,
        htmlContent: richEditor.getHtml(),
      });
      showNotification('Saved successfully');
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
  }

  async function handleSubmit() {
    if (!confirm('Submit this section to the next reviewer?')) return;
    try {
      await Api.post('/api/workflow/save', {
        eventId, sectionId,
        htmlContent: richEditor.getHtml(),
      });
      await Api.post('/api/workflow/submit', { eventId, sectionId });
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

  async function handlePushSection() {
    if (!confirm('Push this section directly to the responsible department?')) return;
    try {
      await Api.post('/api/workflow/push-section', { eventId, sectionId });
      showNotification('Section pushed successfully');
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      alert('Push failed: ' + e.message);
    }
  }

  async function handlePullSection() {
    if (!confirm('Pull this section to yourself?')) return;
    try {
      await Api.post('/api/workflow/pull-section', { eventId, sectionId });
      showNotification('Section pulled successfully');
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      alert('Pull failed: ' + e.message);
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

  // ─── Files ──────────────────────────────────────────────────────────────────

  async function handleFiles() {
    const filesPanel = document.getElementById('filesPanel');
    if (filesPanel.style.display === 'none') {
      filesPanel.style.display = '';
      loadFiles();
    } else {
      filesPanel.style.display = 'none';
    }
  }

  async function loadFiles() {
    const list = document.getElementById('filesList');
    try {
      const files = await Api.get(`/api/library/${eventId}/files`);
      if (!files || files.length === 0) {
        list.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">No files uploaded</p>';
        return;
      }
      list.innerHTML = files.map(f => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border-color);">
          <span style="font-size:13px;">${escapeHtml(f.filename)}</span>
          <a href="${API_BASE}/api/workflow/files/download?event_id=${eventId}&filename=${encodeURIComponent(f.filename)}"
             class="btn btn-outline" style="padding:4px 10px;font-size:12px;" download>Download</a>
        </div>
      `).join('');
    } catch (e) {
      list.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Could not load files</p>';
    }
  }

  document.getElementById('fileUploadInput').addEventListener('change', async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const formData = new FormData();
    formData.append('eventId', eventId);
    for (const file of files) {
      formData.append('files', file);
    }

    try {
      const token = Api.getToken();
      const res = await fetch(`${API_BASE}/api/workflow/files/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Upload failed');
      }
      showNotification('Files uploaded');
      loadFiles();
      e.target.value = '';
    } catch (err) {
      alert('Upload failed: ' + err.message);
    }
  });

  // ─── Comments ────────────────────────────────────────────────────────────────

  async function loadComments() {
    try {
      const comments = await Api.get(`/api/workflow/comments?event_id=${eventId}&section_id=${sectionId}`);

      // Feed comments into the editor's margin balloons
      const editorComments = (comments || []).map(c => ({
        id: c.id,
        anchor_id: c.anchorId || null,
        parent_id: c.parentId || null,
        author_name: c.userName || 'User',
        comment_text: c.content || '',
        created_at: c.createdAt || new Date().toISOString(),
        can_delete: c.userId === user.id || user.role === 'admin',
      }));
      richEditor.setComments(editorComments);
    } catch (e) {
      console.error('Load comments error:', e);
    }
  }

  // ─── History ─────────────────────────────────────────────────────────────────

  const HISTORY_STAGES = [
    { role: 'COLLABORATOR', label: 'Collaborator' },
    { role: 'SUPER_COLLABORATOR', label: 'Super-Collaborator' },
    { role: 'CURATOR', label: 'Curator' },
    { role: 'SUPERVISOR', label: 'Supervisor' },
    { role: 'DEPUTY', label: 'Deputy' },
    { role: 'RECEIVING_SUPER_COLLABORATOR', label: 'Super-Collaborator (Review)' },
    { role: 'RECEIVING_SUPERVISOR', label: 'Supervisor (Review)' },
  ];

  const ACTION_COLORS = {
    saved:           { bg: '#f1f5f9', color: '#475569', label: 'Edited' },
    submitted:       { bg: '#dbeafe', color: '#1d4ed8', label: 'Submitted' },
    approved:        { bg: '#dcfce7', color: '#15803d', label: 'Approved' },
    returned:        { bg: '#fee2e2', color: '#dc2626', label: 'Returned' },
    asked_to_return: { bg: '#fef9c3', color: '#a16207', label: 'Asked to Return' },
    pushed:          { bg: '#e0e7ff', color: '#4338ca', label: 'Pushed' },
    pulled:          { bg: '#e0e7ff', color: '#4338ca', label: 'Pulled' },
  };

  async function loadHistory() {
    try {
      const result = await Api.get(`/api/workflow/section-history?event_id=${eventId}&section_id=${sectionId}`);
      const history = result.history || result;
      const list = document.getElementById('historyList');
      if (!history || history.length === 0) {
        list.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">No history yet</p>';
        return;
      }

      // Group by role
      const byRole = {};
      for (const h of history) {
        const r = h.userRole || 'UNKNOWN';
        if (!byRole[r]) byRole[r] = [];
        byRole[r].push(h);
      }

      // Collapse consecutive saves by same user
      function collapseEntries(entries) {
        const collapsed = [];
        for (const ev of entries) {
          const last = collapsed[collapsed.length - 1];
          if (last && last.action === 'saved' && ev.action === 'saved' && last.userName === ev.userName) {
            last.actedAt = ev.actedAt;
            last._count = (last._count || 1) + 1;
          } else {
            collapsed.push({ ...ev });
          }
        }
        return collapsed;
      }

      // Build ordered stages — only show stages that have entries
      const stageOrder = HISTORY_STAGES.map(s => s.role);
      const orderedRoles = [];
      for (const stage of HISTORY_STAGES) {
        if (byRole[stage.role]) orderedRoles.push(stage);
      }
      for (const role of Object.keys(byRole)) {
        if (!stageOrder.includes(role)) {
          orderedRoles.push({ role, label: roleLabel(role) });
        }
      }

      list.innerHTML = orderedRoles.map(stage => {
        const entries = collapseEntries(byRole[stage.role]);
        const eventsHtml = entries.map(h => {
          const ac = ACTION_COLORS[h.action] || { bg: '#f1f5f9', color: '#475569', label: h.action };
          const actor = escapeHtml(h.userName || 'Unknown');
          const date = formatDateTime(h.actedAt);
          const label = h.action === 'saved' && h._count > 1
            ? `${ac.label} (\u00d7${h._count})` : ac.label;

          if (h.action === 'returned' || h.action === 'asked_to_return') {
            const noteHtml = h.note
              ? escapeHtml(h.note)
              : '<span style="color:var(--text-muted);font-style:italic;">No comment</span>';
            return `<div class="sh-event">
              <span class="sh-actor">${actor}</span>
              <details class="sh-return-details${h.action === 'asked_to_return' ? ' sh-return-details--ask' : ''}">
                <summary><span class="sh-action-tag" style="background:${ac.bg};color:${ac.color}">${escapeHtml(label)} \u25b8</span></summary>
                <div class="sh-return-note">${noteHtml}</div>
              </details>
              <span class="sh-date">${date}</span>
            </div>`;
          }

          return `<div class="sh-event">
            <span class="sh-actor">${actor}</span>
            <span class="sh-action-tag" style="background:${ac.bg};color:${ac.color}">${escapeHtml(label)}</span>
            <span class="sh-date">${date}</span>
          </div>`;
        }).join('');

        return `<div class="sh-stage">
          <div class="sh-stage-label">${escapeHtml(stage.label.toUpperCase())}</div>
          <div class="sh-events">${eventsHtml}</div>
        </div>`;
      }).join('');
    } catch (e) {
      console.error('Load history error:', e);
    }
  }
})();
