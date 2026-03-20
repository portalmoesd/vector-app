/**
 * Library Page
 * - Lists completed/archived documents the user participated in
 * - Client-side filtering (keyword, country, date range)
 * - Preview modal showing full document content
 * - Export to PDF placeholder (requires html2pdf.js)
 */
(async function () {
  await App.init();

  const user = Api.getUser();
  if (!user) return;

  const libraryList = document.getElementById('libraryList');
  const filterKeyword = document.getElementById('filterKeyword');
  const filterCountry = document.getElementById('filterCountry');
  const filterDateFrom = document.getElementById('filterDateFrom');
  const filterDateTo = document.getElementById('filterDateTo');

  let documents = [];
  let countries = [];

  // Load data
  try {
    [documents, countries] = await Promise.all([
      Api.get('/api/library'),
      Api.get('/api/countries'),
    ]);
  } catch (e) {
    libraryList.innerHTML = `<div class="msg msg-error">${escapeHtml(e.message)}</div>`;
    return;
  }

  // Populate country filter
  filterCountry.innerHTML = '<option value="">All</option>' +
    countries.map(c => `<option value="${c.name_en || c.nameEn || c.name}">${escapeHtml(c.name_en || c.nameEn || c.name)}</option>`).join('');

  // Filters
  [filterKeyword, filterCountry, filterDateFrom, filterDateTo].forEach(el => {
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });

  function getFiltered() {
    const kw = filterKeyword.value.toLowerCase().trim();
    const country = filterCountry.value;
    const dateFrom = filterDateFrom.value ? new Date(filterDateFrom.value) : null;
    const dateTo = filterDateTo.value ? new Date(filterDateTo.value) : null;

    return documents.filter(d => {
      if (kw && !(d.title || '').toLowerCase().includes(kw) &&
                !(d.countryName || '').toLowerCase().includes(kw)) return false;
      if (country && d.countryName !== country) return false;
      if (d.endedAt) {
        const ended = new Date(d.endedAt);
        if (dateFrom && ended < dateFrom) return false;
        if (dateTo && ended > new Date(dateTo.getTime() + 86400000)) return false;
      }
      return true;
    });
  }

  function render() {
    const filtered = getFiltered();

    if (filtered.length === 0) {
      libraryList.innerHTML = '<div class="empty-state"><p>No documents found</p></div>';
      return;
    }

    libraryList.innerHTML = filtered.map(d => `
      <div class="doc-card">
        <div class="doc-card-info">
          <h4>${escapeHtml(d.title)}</h4>
          <div class="doc-card-meta">
            <span>${escapeHtml(d.countryName)}</span>
            <span>Language: ${d.language}</span>
            <span>DS: ${escapeHtml(d.documentSubmitterName)}</span>
            ${d.endedAt ? `<span>Completed: ${formatDate(d.endedAt)}</span>` : ''}
          </div>
        </div>
        <div class="doc-card-actions">
          <button class="btn btn-outline" onclick="previewDoc(${d.id})">
            <span class="icon" style="--icon-url: url(/assets/view-icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url); width:16px;height:16px;display:inline-block;background:currentColor;"></span>
            Preview
          </button>
          <button class="btn btn-outline" onclick="exportPdf(${d.id})">
            <span class="icon" style="--icon-url: url(/assets/export-pdf-icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url); width:16px;height:16px;display:inline-block;background:currentColor;"></span>
            PDF
          </button>
        </div>
      </div>
    `).join('');
  }

  // Preview document
  window.previewDoc = async function(eventId) {
    try {
      const doc = await Api.get(`/api/library/${eventId}/document`);

      const overlay = document.createElement('div');
      overlay.className = 'preview-overlay';
      overlay.innerHTML = `
        <div class="preview-card">
          <div class="preview-header">
            <h2>${escapeHtml(doc.title)}</h2>
            <button class="preview-close" onclick="this.closest('.preview-overlay').remove()">&times;</button>
          </div>
          <div style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">
            ${escapeHtml(doc.countryName)} | Language: ${doc.language}
          </div>
          ${doc.sections.map(s => `
            <div class="section-block">
              <h3>${escapeHtml(s.title)}</h3>
              <div>${s.htmlContent || '<em>No content</em>'}</div>
            </div>
          `).join('')}
        </div>
      `;

      // Close on backdrop click
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
      });

      document.body.appendChild(overlay);
    } catch (e) {
      alert('Failed to load document: ' + e.message);
    }
  };

  // Export PDF (requires html2pdf.js loaded externally)
  window.exportPdf = async function(eventId) {
    try {
      const doc = await Api.get(`/api/library/${eventId}/document`);

      // Build HTML for PDF
      const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h1 style="margin-bottom: 4px;">${escapeHtml(doc.title)}</h1>
          <p style="color: #666; margin-bottom: 24px;">${escapeHtml(doc.countryName)} | ${doc.language}</p>
          ${doc.sections.map(s => `
            <h2 style="border-bottom: 1px solid #ccc; padding-bottom: 4px;">${escapeHtml(s.title)}</h2>
            <div>${s.htmlContent || ''}</div>
          `).join('<hr style="margin: 20px 0;">')}
        </div>
      `;

      // Use html2pdf if available, otherwise fallback to print
      if (typeof html2pdf !== 'undefined') {
        const container = document.createElement('div');
        container.innerHTML = html;
        html2pdf().from(container).set({
          margin: 10,
          filename: `${doc.title}.pdf`,
          html2canvas: { scale: 2 },
          jsPDF: { format: 'a4' },
        }).save();
      } else {
        // Fallback: open print dialog
        const w = window.open('', '_blank');
        w.document.write(`<html><head><title>${escapeHtml(doc.title)}</title></head><body>${html}</body></html>`);
        w.document.close();
        w.print();
      }
    } catch (e) {
      alert('Export failed: ' + e.message);
    }
  };

  render();
})();
