/**
 * Editor-All — Multi-section review page.
 * Accordion layout showing all sections of an event with status and content.
 * Read-only for reviewers, links to individual editor for editing.
 */
(async function () {
  await App.init();

  const user = Api.getUser();
  if (!user) return;

  const params = new URLSearchParams(window.location.search);
  const eventId = parseInt(params.get('event_id'));

  if (!eventId) {
    document.getElementById('sectionsContainer').innerHTML =
      '<div class="msg msg-error">Missing event_id parameter</div>';
    return;
  }

  document.getElementById('btnBack').addEventListener('click', () => {
    window.location.href = dashboardUrl(user.role);
  });

  let grid, event;
  try {
    [grid, event] = await Promise.all([
      Api.get(`/api/workflow/status-grid?event_id=${eventId}`),
      Api.get(`/api/events/${eventId}`),
    ]);
  } catch (e) {
    document.getElementById('sectionsContainer').innerHTML =
      `<div class="msg msg-error">${escapeHtml(e.message)}</div>`;
    return;
  }

  // Only the Document Submitter and Deputies may view all sections at once
  const isDS = grid.documentSubmitterId === user.id;
  const isDeputy = user.role === 'DEPUTY';
  if (!isDS && !isDeputy) {
    document.getElementById('sectionsContainer').innerHTML =
      '<div class="msg msg-error">Access denied — only the Document Submitter and Deputy can view all sections.</div>';
    return;
  }

  document.getElementById('pageTitle').textContent = `${event.title} — All Sections`;

  // Build section navigation
  const nav = document.getElementById('sectionNav');
  nav.innerHTML = grid.sections.map((s, i) =>
    `<a href="#section-${s.sectionId}">${i + 1}. ${escapeHtml(s.sectionLabel)}</a>`
  ).join('');

  // Load all section contents
  const container = document.getElementById('sectionsContainer');
  const contentPromises = grid.sections.map(s =>
    Api.get(`/api/workflow/section-content?event_id=${eventId}&section_id=${s.sectionId}`)
      .catch(() => ({ htmlContent: '', status: 'draft' }))
  );
  const contents = await Promise.all(contentPromises);

  // Render each section with a read-only GCP.RichEditor instance
  grid.sections.forEach((s, i) => {
    const content = contents[i];
    const status = s.status || 'draft';

    const card = document.createElement('div');
    card.className = 'section-card';
    card.id = `section-${s.sectionId}`;
    card.innerHTML = `
      <div class="section-card-header" onclick="toggleSection(this)">
        <h3>${i + 1}. ${escapeHtml(s.sectionLabel)}</h3>
        <div style="display:flex;gap:12px;align-items:center;">
          <span class="${statusClass(status)}" style="font-size:13px;">${statusLabel(status)}</span>
          <span class="toggle">▼</span>
        </div>
      </div>
      <div class="section-card-body">
        <div class="section-status-bar">
          <span>Last updated: ${formatDateTime(s.lastUpdatedAt)}</span>
          ${s.lastUpdatedBy ? `<span>by ${escapeHtml(s.lastUpdatedBy)}</span>` : ''}
          <a href="/pages/editor.html?event_id=${eventId}&section_id=${s.sectionId}"
             style="color:var(--accent-blue);">Open in Editor →</a>
        </div>
        <div class="section-editor-container"></div>
      </div>
    `;
    container.appendChild(card);

    // Initialize read-only GCP.RichEditor in each section
    const editorContainer = card.querySelector('.section-editor-container');
    if (content.htmlContent) {
      GCP.RichEditor({
        container: editorContainer,
        initialHtml: content.htmlContent,
        authorName: user.fullName || user.username,
        sectionTitle: s.sectionLabel,
        readOnly: true,
      });
    } else {
      editorContainer.innerHTML = '<em style="color:var(--text-muted);padding:16px;display:block;">No content yet</em>';
    }
  });

  // Toggle accordion
  window.toggleSection = function(header) {
    const body = header.nextElementSibling;
    const toggle = header.querySelector('.toggle');
    body.classList.toggle('collapsed');
    toggle.textContent = body.classList.contains('collapsed') ? '▶' : '▼';
  };
})();
