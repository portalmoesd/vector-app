/**
 * Library Page
 * - Lists completed/archived documents the user participated in
 * - Client-side filtering (keyword, country, date range)
 * - Preview modal with full document content
 * - Export to PDF (html2pdf.js) with section selection
 * - Export to Word (docx) with track changes as native Word revisions
 * - View files modal
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
            <span>Language: ${languageLabel(d.language)}</span>
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
          <button class="btn btn-outline" onclick="exportWord(${d.id})">
            <span class="icon" style="--icon-url: url(/assets/export-word-icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url); width:16px;height:16px;display:inline-block;background:currentColor;"></span>
            Word
          </button>
          <button class="btn btn-outline" onclick="viewFiles(${d.id})">
            <span class="icon" style="--icon-url: url(/assets/files-icon.svg); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url); width:16px;height:16px;display:inline-block;background:currentColor;"></span>
            Files
          </button>
        </div>
      </div>
    `).join('');
  }

  // ── Section selection modal helper ──────────────────────────────────────────
  function showSectionSelectModal(doc, title, onExport) {
    const overlay = document.createElement('div');
    overlay.className = 'preview-overlay';
    overlay.innerHTML = `
      <div class="preview-card" style="max-width:500px;">
        <div class="preview-header">
          <h2>${escapeHtml(title)}</h2>
          <button class="preview-close" onclick="this.closest('.preview-overlay').remove()">&times;</button>
        </div>
        <div style="margin-bottom:16px;">
          <label style="cursor:pointer;font-weight:600;">
            <input type="checkbox" id="selectAllSections" checked /> Select all
          </label>
        </div>
        <div id="sectionChecklist">
          ${doc.sections.map((s, i) => `
            <label style="display:block;padding:4px 0;cursor:pointer;">
              <input type="checkbox" class="section-check" data-idx="${i}" checked />
              ${escapeHtml(s.title)}
            </label>
          `).join('')}
        </div>
        <div style="margin-top:16px;text-align:right;">
          <button class="btn btn-outline" onclick="this.closest('.preview-overlay').remove()">Cancel</button>
          <button class="btn btn-primary" id="exportConfirmBtn" style="margin-left:8px;">${escapeHtml(title)}</button>
        </div>
      </div>
    `;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);

    // Select all toggle
    overlay.querySelector('#selectAllSections').addEventListener('change', (e) => {
      overlay.querySelectorAll('.section-check').forEach(cb => cb.checked = e.target.checked);
    });

    // Export button
    overlay.querySelector('#exportConfirmBtn').addEventListener('click', () => {
      const selectedIdxs = Array.from(overlay.querySelectorAll('.section-check:checked'))
        .map(cb => parseInt(cb.dataset.idx));
      const selectedSections = selectedIdxs.map(i => doc.sections[i]);
      if (selectedSections.length === 0) { toast.warn('Select at least one section.'); return; }
      overlay.remove();
      onExport(selectedSections);
    });
  }

  // ── Preview ────────────────────────────────────────────────────────────────
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
            ${escapeHtml(doc.countryName)} | Language: ${languageLabel(doc.language)}
          </div>
          ${doc.sections.map(s => `
            <div class="section-block">
              <h3>${escapeHtml(s.title)}</h3>
              <div class="section-content-preview">${stripTrackChanges(s.htmlContent || '<em>No content</em>')}</div>
            </div>
          `).join('')}
        </div>
      `;

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
      });

      document.body.appendChild(overlay);

      // Hide track changes in preview (show accepted view)
      overlay.querySelectorAll('.section-content-preview del').forEach(el => el.style.display = 'none');
      overlay.querySelectorAll('.section-content-preview ins').forEach(el => {
        el.style.textDecoration = 'none';
        el.style.backgroundColor = 'transparent';
        el.style.color = 'inherit';
      });
    } catch (e) {
      toast.error('Failed to load document: ' + e.message);
    }
  };

  function stripTrackChanges(html) {
    // Remove del elements, unwrap ins elements for clean preview
    const div = document.createElement('div');
    div.innerHTML = html;
    div.querySelectorAll('del').forEach(el => el.remove());
    div.querySelectorAll('ins').forEach(el => {
      const parent = el.parentNode;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    });
    return div.innerHTML;
  }

  // ── Export PDF ─────────────────────────────────────────────────────────────
  window.exportPdf = async function(eventId) {
    try {
      const doc = await Api.get(`/api/library/${eventId}/document`);
      showSectionSelectModal(doc, 'Export PDF', (sections) => {
        const html = `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h1 style="margin-bottom: 4px;">${escapeHtml(doc.title)}</h1>
            <p style="color: #666; margin-bottom: 24px;">${escapeHtml(doc.countryName)} | ${doc.language}</p>
            ${sections.map(s => `
              <h2 style="border-bottom: 1px solid #ccc; padding-bottom: 4px;">${escapeHtml(s.title)}</h2>
              <div>${stripTrackChanges(s.htmlContent || '')}</div>
            `).join('<hr style="margin: 20px 0;">')}
          </div>
        `;

        if (typeof html2pdf !== 'undefined') {
          const container = document.createElement('div');
          container.innerHTML = html;
          const slug = doc.title.replace(/[^a-zA-Z0-9]+/g, '-').substring(0, 80);
          html2pdf().from(container).set({
            margin: [12.7, 12.7, 12.7, 12.7],
            filename: `${slug}.pdf`,
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: { format: 'a4', orientation: 'portrait' },
            image: { type: 'jpeg', quality: 0.98 },
          }).save();
        } else {
          // Fallback: open print dialog
          const w = window.open('', '_blank');
          w.document.write(`<html><head><title>${escapeHtml(doc.title)}</title></head><body>${html}</body></html>`);
          w.document.close();
          w.print();
        }
      });
    } catch (e) {
      toast.error('Export failed: ' + e.message);
    }
  };

  // ── Export Word ────────────────────────────────────────────────────────────
  window.exportWord = async function(eventId) {
    try {
      const doc = await Api.get(`/api/library/${eventId}/document`);
      showSectionSelectModal(doc, 'Export Word', async (sections) => {
        try {
          await generateDocx(doc, sections);
        } catch (err) {
          toast.error('Word export failed: ' + err.message);
        }
      });
    } catch (e) {
      toast.error('Export failed: ' + e.message);
    }
  };

  async function generateDocx(doc, sections) {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
            InsertedTextRun, DeletedTextRun, SectionType, PageSize, convertMillimetersToTwip } = docx;

    let revisionId = 1;

    function parseColor(colorStr) {
      if (!colorStr) return undefined;
      if (colorStr.startsWith('#')) return colorStr.slice(1).toUpperCase();
      if (colorStr.startsWith('rgb')) {
        const match = colorStr.match(/\d+/g);
        if (match && match.length >= 3) {
          return match.slice(0, 3).map(n => parseInt(n).toString(16).padStart(2, '0')).join('').toUpperCase();
        }
      }
      return undefined;
    }

    function parseFontSize(sizeStr) {
      if (!sizeStr) return undefined;
      const num = parseFloat(sizeStr);
      if (sizeStr.includes('pt')) return num * 2; // half-points
      if (sizeStr.includes('px')) return Math.round(num * 1.5); // approximate px to half-points
      return num * 2;
    }

    function extractTextRuns(element, inherited) {
      const runs = [];
      inherited = inherited || {};

      for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent;
          if (!text) continue;

          const runProps = {
            text,
            bold: inherited.bold,
            italics: inherited.italics,
            underline: inherited.underline ? {} : undefined,
            strike: inherited.strike,
            font: inherited.font,
            size: inherited.size,
            color: inherited.color,
          };

          if (inherited.isInsert) {
            runs.push(new InsertedTextRun({
              ...runProps,
              id: revisionId++,
              author: inherited.author || 'Unknown',
              date: inherited.date || new Date().toISOString(),
            }));
          } else if (inherited.isDelete) {
            runs.push(new DeletedTextRun({
              ...runProps,
              id: revisionId++,
              author: inherited.author || 'Unknown',
              date: inherited.date || new Date().toISOString(),
            }));
          } else {
            runs.push(new TextRun(runProps));
          }
          continue;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        const tag = node.tagName.toLowerCase();
        const style = node.style || {};
        const newInherited = { ...inherited };

        if (tag === 'b' || tag === 'strong') newInherited.bold = true;
        if (tag === 'i' || tag === 'em') newInherited.italics = true;
        if (tag === 'u') newInherited.underline = true;
        if (tag === 's' || tag === 'strike' || tag === 'del') {
          if (tag === 'del') {
            newInherited.isDelete = true;
            newInherited.author = node.getAttribute('data-author') || node.getAttribute('author') || inherited.author || 'Author';
            newInherited.date = node.getAttribute('data-date') || node.getAttribute('datetime') || inherited.date;
          } else {
            newInherited.strike = true;
          }
        }
        if (tag === 'ins') {
          newInherited.isInsert = true;
          newInherited.author = node.getAttribute('data-author') || node.getAttribute('author') || inherited.author || 'Author';
          newInherited.date = node.getAttribute('data-date') || node.getAttribute('datetime') || inherited.date;
        }

        if (style.fontFamily) newInherited.font = style.fontFamily.replace(/['"]/g, '').split(',')[0].trim();
        if (style.fontSize) newInherited.size = parseFontSize(style.fontSize);
        if (style.color) newInherited.color = parseColor(style.color);
        if (style.fontWeight === 'bold' || parseInt(style.fontWeight) >= 700) newInherited.bold = true;
        if (style.fontStyle === 'italic') newInherited.italics = true;
        if (style.textDecoration && style.textDecoration.includes('underline')) newInherited.underline = true;

        if (tag === 'br') {
          runs.push(new TextRun({ break: 1 }));
          continue;
        }

        runs.push(...extractTextRuns(node, newInherited));
      }

      return runs;
    }

    function getAlignment(element) {
      const align = (element.style && element.style.textAlign) || element.getAttribute('align');
      if (align === 'center') return AlignmentType.CENTER;
      if (align === 'right') return AlignmentType.RIGHT;
      if (align === 'justify') return AlignmentType.JUSTIFIED;
      return AlignmentType.LEFT;
    }

    function htmlToParagraphs(htmlString) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = htmlString || '';
      const paragraphs = [];

      for (const child of tempDiv.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const text = child.textContent.trim();
          if (text) {
            paragraphs.push(new Paragraph({ children: [new TextRun(text)] }));
          }
          continue;
        }

        if (child.nodeType !== Node.ELEMENT_NODE) continue;

        const tag = child.tagName.toLowerCase();

        // Headings
        if (tag === 'h1') {
          paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: extractTextRuns(child) }));
        } else if (tag === 'h2') {
          paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: extractTextRuns(child) }));
        } else if (tag === 'h3') {
          paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: extractTextRuns(child) }));
        } else if (tag === 'h4') {
          paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_4, children: extractTextRuns(child) }));
        }
        // Lists
        else if (tag === 'ul' || tag === 'ol') {
          paragraphs.push(...parseList(child, tag === 'ol', 0));
        }
        // Tables — flatten to tab-delimited text
        else if (tag === 'table') {
          child.querySelectorAll('tr').forEach(tr => {
            const cells = [];
            tr.querySelectorAll('td, th').forEach(cell => {
              cells.push(cell.textContent.trim());
            });
            paragraphs.push(new Paragraph({ children: [new TextRun(cells.join('\t'))] }));
          });
        }
        // Block elements
        else if (tag === 'p' || tag === 'div' || tag === 'blockquote') {
          const runs = extractTextRuns(child);
          if (runs.length > 0) {
            paragraphs.push(new Paragraph({
              alignment: getAlignment(child),
              children: runs,
            }));
          }
        }
        // Inline fallback
        else {
          const runs = extractTextRuns(child);
          if (runs.length > 0) {
            paragraphs.push(new Paragraph({ children: runs }));
          }
        }
      }

      if (paragraphs.length === 0) {
        paragraphs.push(new Paragraph({ children: [new TextRun('')] }));
      }

      return paragraphs;
    }

    function parseList(listElement, isOrdered, level) {
      const paragraphs = [];
      const items = listElement.children;

      for (const item of items) {
        if (item.tagName.toLowerCase() !== 'li') continue;

        // Get direct text content (not nested lists)
        const runs = [];
        for (const child of item.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            const text = child.textContent;
            if (text.trim()) runs.push(new TextRun(text));
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            const tag = child.tagName.toLowerCase();
            if (tag === 'ul' || tag === 'ol') {
              // Nested list — process recursively
              paragraphs.push(new Paragraph({
                children: runs.length > 0 ? runs : [new TextRun('')],
                bullet: isOrdered ? undefined : { level },
                numbering: isOrdered ? { reference: 'default-numbering', level } : undefined,
              }));
              paragraphs.push(...parseList(child, tag === 'ol', level + 1));
              runs.length = 0;
              continue;
            }
            runs.push(...extractTextRuns(child));
          }
        }

        if (runs.length > 0) {
          paragraphs.push(new Paragraph({
            children: runs,
            bullet: isOrdered ? undefined : { level },
            numbering: isOrdered ? { reference: 'default-numbering', level } : undefined,
          }));
        }
      }

      return paragraphs;
    }

    // Build document
    const children = [];

    // Title
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: doc.title, bold: true })],
    }));

    // Metadata
    children.push(new Paragraph({
      children: [
        new TextRun({ text: `${doc.countryName} | Language: ${languageLabel(doc.language)}`, color: '666666', size: 20 }),
      ],
      spacing: { after: 400 },
    }));

    // Sections
    for (const section of sections) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: section.title })],
        spacing: { before: 400 },
      }));

      children.push(...htmlToParagraphs(section.htmlContent));
    }

    const docObj = new Document({
      sections: [{
        properties: {
          page: {
            size: { width: convertMillimetersToTwip(210), height: convertMillimetersToTwip(297) },
            margin: {
              top: convertMillimetersToTwip(25.4),
              right: convertMillimetersToTwip(25.4),
              bottom: convertMillimetersToTwip(25.4),
              left: convertMillimetersToTwip(25.4),
            },
          },
        },
        children,
      }],
    });

    const blob = await Packer.toBlob(docObj);
    const slug = doc.title.replace(/[^a-zA-Z0-9]+/g, '-').substring(0, 80);
    saveAs(blob, `${slug}.docx`);
  }

  // ── View Files ────────────────────────────────────────────────────────────
  window.viewFiles = async function(eventId) {
    try {
      const files = await Api.get(`/api/library/${eventId}/files`);

      const overlay = document.createElement('div');
      overlay.className = 'preview-overlay';
      overlay.innerHTML = `
        <div class="preview-card" style="max-width:700px;">
          <div class="preview-header">
            <h2>Uploaded Files</h2>
            <button class="preview-close" onclick="this.closest('.preview-overlay').remove()">&times;</button>
          </div>
          ${files.length === 0 ? '<p>No files uploaded for this event.</p>' : `
            <div class="table-wrap"><table>
              <thead><tr><th>File</th><th>Section</th><th>Uploaded</th><th>By</th><th>Size</th></tr></thead>
              <tbody>${files.map(f => `
                <tr>
                  <td><a href="${API_BASE}/api/workflow/files/download?id=${f.id}" target="_blank">${escapeHtml(f.original_name)}</a></td>
                  <td>${escapeHtml(f.section_title || '—')}</td>
                  <td>${formatDate(f.created_at)}</td>
                  <td>${escapeHtml(f.uploaded_by_name || '—')}</td>
                  <td>${f.size ? (f.size / 1024).toFixed(1) + ' KB' : '—'}</td>
                </tr>
              `).join('')}</tbody>
            </table></div>
          `}
        </div>
      `;

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
      });

      document.body.appendChild(overlay);
    } catch (e) {
      toast.error('Failed to load files: ' + e.message);
    }
  };

  render();
})();
