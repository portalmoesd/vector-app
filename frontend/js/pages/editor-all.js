/**
 * Editor-All — Continuous-document editing page.
 * Stacks all sections vertically with subtle dividers.
 * Each section keeps its own RichEditor, track changes, comments, and workflow.
 */
(async function () {
  await App.init();

  const user = Api.getUser();
  if (!user) return;

  const params = new URLSearchParams(window.location.search);
  const eventId = parseInt(params.get('event_id'));

  if (!eventId) {
    document.getElementById('docFlow').innerHTML =
      '<div class="msg msg-error" style="margin:24px;">Missing event_id parameter</div>';
    return;
  }

  document.getElementById('btnBack').addEventListener('click', () => {
    window.location.href = dashboardUrl(user.role);
  });

  // ── Load data ────────────────────────────────────────────────────────────

  let grid, event;
  try {
    [grid, event] = await Promise.all([
      Api.get(`/api/workflow/status-grid?event_id=${eventId}`),
      Api.get(`/api/events/${eventId}`),
    ]);
  } catch (e) {
    document.getElementById('docFlow').innerHTML =
      `<div class="msg msg-error" style="margin:24px;">${escapeHtml(e.message)}</div>`;
    return;
  }

  // Access control
  const isDS = grid.documentSubmitterId === user.id;
  const canViewAll = isDS || user.role === 'DEPUTY' || user.role === 'SUPERVISOR' || user.role === 'SUPER_COLLABORATOR';
  if (!canViewAll) {
    document.getElementById('docFlow').innerHTML =
      '<div class="msg msg-error" style="margin:24px;">Access denied — you do not have permission to view all sections.</div>';
    return;
  }

  document.getElementById('pageTitle').textContent = `${event.title} — All Sections`;

  // ── Build section navigation ─────────────────────────────────────────────

  const nav = document.getElementById('sectionNav');
  const navLinks = {};
  nav.innerHTML = grid.sections.map((s, i) => {
    const id = `nav-link-${s.sectionId}`;
    return `<a href="#section-${s.sectionId}" id="${id}">${i + 1}. ${escapeHtml(s.sectionLabel)}</a>`;
  }).join('');
  grid.sections.forEach(s => {
    navLinks[s.sectionId] = document.getElementById(`nav-link-${s.sectionId}`);
  });

  // Smooth scroll on nav click
  nav.addEventListener('click', e => {
    const link = e.target.closest('a');
    if (!link) return;
    e.preventDefault();
    const target = document.querySelector(link.getAttribute('href'));
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // ── Load all section contents ────────────────────────────────────────────

  const contentPromises = grid.sections.map(s =>
    Api.get(`/api/workflow/section-content?event_id=${eventId}&section_id=${s.sectionId}`)
      .catch(() => ({ htmlContent: '', status: 'draft' }))
  );
  const contents = await Promise.all(contentPromises);

  // ── Render sections ──────────────────────────────────────────────────────

  const docFlow = document.getElementById('docFlow');
  const sections = {}; // sectionId → { editor, sectionInfo, canEdit, dividerEl, sectionEl }
  let focusedSectionId = null;
  let activeDropdown = null;

  function closeDropdown() {
    if (activeDropdown) { activeDropdown.remove(); activeDropdown = null; }
  }
  document.addEventListener('mousedown', e => {
    if (activeDropdown && !activeDropdown.contains(e.target) && !e.target.closest('.section-action-trigger')) {
      closeDropdown();
    }
  }, true);

  grid.sections.forEach((s, i) => {
    const content = contents[i];
    const effectiveRole = s.userEffectiveRole || user.role;
    const isHolder = s.currentHolderRole === effectiveRole;
    const canEdit = isHolder;
    const status = s.status || 'draft';

    // ── Section wrapper ──
    const sectionEl = document.createElement('div');
    sectionEl.className = 'doc-section' + (canEdit ? '' : ' doc-section--readonly');
    sectionEl.id = `section-${s.sectionId}`;

    // ── Divider ──
    const divider = document.createElement('div');
    divider.className = 'doc-section-divider';
    divider.innerHTML = `
      <h3>${i + 1}. ${escapeHtml(s.sectionLabel)}</h3>
      <span class="${statusClass(status)}" style="font-size:12px;">${statusLabel(status)}</span>
      ${!canEdit ? '<span class="readonly-badge"><svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a4 4 0 0 0-4 4v3H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-1V5a4 4 0 0 0-4-4zm-2 4a2 2 0 1 1 4 0v3H6V5z"/></svg> Read-only</span>' : ''}
      <span class="section-actions">
        <button class="section-action-trigger" data-section-id="${s.sectionId}" title="Section actions">&#8942;</button>
      </span>
    `;
    sectionEl.appendChild(divider);

    // ── Editor container ──
    const editorContainer = document.createElement('div');
    editorContainer.className = 'section-editor-container';
    sectionEl.appendChild(editorContainer);

    docFlow.appendChild(sectionEl);

    // ── Create RichEditor ──
    const editor = GCP.RichEditor({
      container: editorContainer,
      initialHtml: content.htmlContent || '',
      authorName: user.fullName || user.username,
      sectionTitle: s.sectionLabel,
      readOnly: !canEdit,
      async onCommentsClick(anchorId) {
        if (!anchorId) return;
        const anchorSpan = editorContainer.querySelector(`.gcp-cmt-anchor[data-cmt-anchor-id="${anchorId}"]`);
        const text = await GCP.ActionDialog.popoverPrompt(
          anchorSpan || editorContainer,
          'Add comment',
          { placeholder: 'Enter your comment...', required: true, confirmLabel: 'Add', confirmColor: '#3b82f6', fixed: true }
        );
        if (text && text.trim()) {
          Api.post('/api/workflow/comments', {
            eventId, sectionId: s.sectionId, content: text.trim(), anchorId,
            htmlContent: editor.getHtml(),
          }).then(() => loadCommentsForSection(s.sectionId)).catch(e => alert('Failed: ' + e.message));
        } else {
          editor.removeCommentAnchor(anchorId);
        }
      },
      async onDeleteComment(commentId, anchorId) {
        try {
          await Api.post('/api/workflow/comments/delete', { commentId });
          if (anchorId) {
            editor.removeCommentAnchor(anchorId);
            Api.post('/api/workflow/save', {
              eventId, sectionId: s.sectionId,
              htmlContent: editor.getHtml(),
            }).catch(e => console.error('Auto-save after anchor removal failed:', e));
          }
          loadCommentsForSection(s.sectionId);
        } catch (e) { console.error('Delete comment failed:', e); }
      },
      async onReplyComment(parentId, text) {
        try {
          await Api.post('/api/workflow/comments', {
            eventId, sectionId: s.sectionId, content: text, parentId,
          });
          loadCommentsForSection(s.sectionId);
        } catch (e) { alert('Reply failed: ' + e.message); }
      },
    });

    sections[s.sectionId] = { editor, sectionInfo: s, canEdit, dividerEl: divider, sectionEl, effectiveRole };

    // ── Focus tracking ──
    if (editor.el) {
      editor.el.addEventListener('focusin', () => setFocusedSection(s.sectionId));
    }

    // Load comments
    loadCommentsForSection(s.sectionId);
  });

  // ── Focus management ─────────────────────────────────────────────────────

  function setFocusedSection(sectionId) {
    if (focusedSectionId === sectionId) return;
    // Remove focus from previous
    if (focusedSectionId && sections[focusedSectionId]) {
      sections[focusedSectionId].sectionEl.classList.remove('focused');
    }
    focusedSectionId = sectionId;
    if (sections[sectionId]) {
      sections[sectionId].sectionEl.classList.add('focused');
    }
    // Update nav
    Object.entries(navLinks).forEach(([id, link]) => {
      link.classList.toggle('active', parseInt(id) === sectionId);
    });
  }

  // ── IntersectionObserver for scroll-based nav sync ───────────────────────

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = parseInt(entry.target.id.replace('section-', ''));
        Object.values(navLinks).forEach(l => l.classList.remove('active'));
        if (navLinks[id]) navLinks[id].classList.add('active');
      }
    });
  }, { rootMargin: '-60px 0px -70% 0px', threshold: 0 });

  Object.values(sections).forEach(s => observer.observe(s.sectionEl));

  // ── Action dropdown ──────────────────────────────────────────────────────

  docFlow.addEventListener('click', e => {
    const trigger = e.target.closest('.section-action-trigger');
    if (!trigger) return;
    e.stopPropagation();
    const sid = parseInt(trigger.dataset.sectionId);
    const sec = sections[sid];
    if (!sec) return;

    // Toggle if already open
    if (activeDropdown && activeDropdown.dataset.sectionId === String(sid)) {
      closeDropdown(); return;
    }
    closeDropdown();

    const dropdown = buildActionDropdown(sec);
    dropdown.dataset.sectionId = String(sid);
    sec.dividerEl.appendChild(dropdown);
    activeDropdown = dropdown;
  });

  function buildActionDropdown(sec) {
    const { sectionInfo: s, canEdit, effectiveRole, editor } = sec;
    const status = s.status || 'draft';
    const isHolder = s.currentHolderRole === effectiveRole;
    const drop = document.createElement('div');
    drop.className = 'section-action-dropdown';

    function addItem(label, colorClass, handler) {
      const item = document.createElement('div');
      item.className = 'section-action-item' + (colorClass ? ' section-action-item--' + colorClass : '');
      item.textContent = label;
      item.addEventListener('click', () => { closeDropdown(); handler(); });
      drop.appendChild(item);
    }

    // Open in Editor
    addItem('Open in Editor', '', () => {
      window.location.href = `/pages/editor.html?event_id=${eventId}&section_id=${s.sectionId}`;
    });

    // Save
    if (canEdit) {
      addItem('Save', 'blue', () => handleSaveSection(s.sectionId));
    }

    if (isHolder) {
      // Submit
      if (status === 'draft' || status.startsWith('returned_')) {
        addItem('Submit', 'blue', () => handleSubmitSection(s.sectionId));
      }
      // Approve + Return
      if (status === `submitted_to_${effectiveRole.toLowerCase()}`) {
        addItem('Approve', 'green', () => handleApproveSection(s.sectionId));
        addItem('Return', 'red', () => handleReturnSection(s.sectionId));
      }
    }

    // Ask to Return
    if (!isHolder && status !== 'draft') {
      const chain = s.chain || [];
      const userIdx = chain.indexOf(effectiveRole);
      const holderIdx = chain.indexOf(s.currentHolderRole);
      if (userIdx !== -1 && holderIdx > userIdx) {
        addItem('Ask to Return', 'orange', () => handleAskReturnSection(s.sectionId));
      }
    }

    // Push / Pull
    if (s.canPush) {
      addItem('Push Section', 'orange', () => handlePushSection(s.sectionId));
    }
    if (s.canPull) {
      addItem('Pull Section', 'purple', () => handlePullSection(s.sectionId));
    }

    return drop;
  }

  // ── Workflow handlers ────────────────────────────────────────────────────

  async function handleSaveSection(sectionId) {
    const sec = sections[sectionId];
    if (!sec) return;
    try {
      await Api.post('/api/workflow/save', {
        eventId, sectionId,
        htmlContent: sec.editor.getHtml(),
      });
      showNotification('Saved successfully');
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
  }

  async function handleSubmitSection(sectionId) {
    const sec = sections[sectionId];
    if (!sec) return;
    if (!await GCP.ActionDialog.confirm('Submit section', { confirmLabel: 'Submit', confirmColor: '#3b82f6' })) return;
    try {
      await Api.post('/api/workflow/save', { eventId, sectionId, htmlContent: sec.editor.getHtml() });
      await Api.post('/api/workflow/submit', { eventId, sectionId });
      showNotification('Submitted successfully');
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      alert('Submit failed: ' + e.message);
    }
  }

  async function handleApproveSection(sectionId) {
    if (!await GCP.ActionDialog.confirm('Approve section', { confirmLabel: 'Approve', confirmColor: '#16a34a' })) return;
    try {
      await Api.post('/api/workflow/approve', { eventId, sectionId });
      showNotification('Approved successfully');
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      alert('Approve failed: ' + e.message);
    }
  }

  async function handleReturnSection(sectionId) {
    const sec = sections[sectionId];
    if (!sec) return;
    const comment = await GCP.ActionDialog.popoverPrompt(
      sec.dividerEl.querySelector('.section-action-trigger'),
      'Return section',
      { placeholder: 'Add a comment...', required: true, confirmLabel: 'Return', confirmColor: '#6d28d9', fixed: true }
    );
    if (!comment) return;
    try {
      await Api.post('/api/workflow/return', { eventId, sectionId, comment });
      showNotification('Returned successfully');
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      alert('Return failed: ' + e.message);
    }
  }

  async function handleAskReturnSection(sectionId) {
    const sec = sections[sectionId];
    if (!sec) return;
    const note = await GCP.ActionDialog.popoverPrompt(
      sec.dividerEl.querySelector('.section-action-trigger'),
      'Request return',
      { placeholder: 'Reason for return request...', required: true, confirmLabel: 'Send request', confirmColor: '#a16207', fixed: true }
    );
    if (!note) return;
    try {
      await Api.post('/api/workflow/ask-return', { eventId, sectionId, comment: note });
      showNotification('Return request sent');
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      alert('Request failed: ' + e.message);
    }
  }

  async function handlePushSection(sectionId) {
    if (!await GCP.ActionDialog.confirm('Push section', { confirmLabel: 'Push section', confirmColor: '#6d28d9' })) return;
    try {
      await Api.post('/api/workflow/push-section', { eventId, sectionId });
      showNotification('Section pushed successfully');
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      alert('Push failed: ' + e.message);
    }
  }

  async function handlePullSection(sectionId) {
    if (!await GCP.ActionDialog.confirm('Pull section', { confirmLabel: 'Pull section', confirmColor: '#7c3aed' })) return;
    try {
      await Api.post('/api/workflow/pull-section', { eventId, sectionId });
      showNotification('Section pulled successfully');
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      alert('Pull failed: ' + e.message);
    }
  }

  // ── Save All ─────────────────────────────────────────────────────────────

  document.getElementById('btnSaveAll').addEventListener('click', async () => {
    const editable = Object.entries(sections).filter(([, s]) => s.canEdit);
    if (editable.length === 0) {
      showNotification('No editable sections to save');
      return;
    }
    const btn = document.getElementById('btnSaveAll');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await Promise.all(editable.map(([sid, s]) =>
        Api.post('/api/workflow/save', {
          eventId, sectionId: parseInt(sid),
          htmlContent: s.editor.getHtml(),
        })
      ));
      showNotification('All sections saved');
    } catch (e) {
      alert('Save failed: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Save All';
    }
  });

  // ── Comments ─────────────────────────────────────────────────────────────

  async function loadCommentsForSection(sectionId) {
    const sec = sections[sectionId];
    if (!sec) return;
    try {
      const comments = await Api.get(`/api/workflow/comments?event_id=${eventId}&section_id=${sectionId}`);
      const editorComments = (comments || []).map(c => ({
        id: c.id,
        anchor_id: c.anchorId || null,
        parent_id: c.parentId || null,
        author_name: c.userName || 'User',
        comment_text: c.content || '',
        created_at: c.createdAt || new Date().toISOString(),
        can_delete: c.userId === user.id || user.role === 'admin',
      }));
      sec.editor.setComments(editorComments);
    } catch (e) {
      console.error('Load comments error for section', sectionId, e);
    }
  }

  // ── Notifications ────────────────────────────────────────────────────────

  function showNotification(msg) {
    const el = document.createElement('div');
    el.className = 'msg msg-success';
    el.textContent = msg;
    el.style.cssText = 'position:fixed;top:16px;right:16px;z-index:999;padding:12px 20px;border-radius:6px;';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }
})();
