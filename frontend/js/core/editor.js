/**
 * GCP — Global Component Provider
 * Custom rich text editor with track changes, inline comments, and full formatting.
 * Based on contenteditable — no external library dependency.
 */
const GCP = (function () {
  'use strict';

  // ─── Author palette (8 colors for track changes attribution) ───────────────
  const AUTHOR_COLORS = [
    '#2563eb', '#dc2626', '#16a34a', '#9333ea',
    '#ea580c', '#0891b2', '#be185d', '#854d0e',
  ];

  function authorColor(name) {
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) {
      hash = ((hash << 5) - hash) + name.charCodeAt(i);
      hash |= 0;
    }
    return AUTHOR_COLORS[Math.abs(hash) % AUTHOR_COLORS.length];
  }

  function authorInitials(name) {
    if (!name) return '??';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  }

  // ─── Unique ID generator ───────────────────────────────────────────────────
  let _idCounter = 0;
  function uid() { return 'gcp-' + (++_idCounter) + '-' + Date.now().toString(36); }

  // ─── RichEditor ─────────────────────────────────────────────────────────────

  function RichEditor(opts) {
    const {
      container,
      initialHtml = '',
      authorName = 'Unknown',
      sectionTitle = '',
      readOnly = false,
      onCommentsClick,
      onDeleteComment,
      onReplyComment,
    } = opts;

    const editorId = uid();
    const color = authorColor(authorName);
    let trackChanges = true;
    let comments = [];

    // ── Build DOM ──────────────────────────────────────────────────────────

    container.innerHTML = '';
    container.classList.add('gcp-editor-root');

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'gcp-toolbar';
    toolbar.innerHTML = buildToolbarHtml();
    container.appendChild(toolbar);

    // Format bar
    const formatBar = document.createElement('div');
    formatBar.className = 'gcp-format-bar';
    formatBar.innerHTML = buildFormatBarHtml();
    container.appendChild(formatBar);

    // Content area
    const contentArea = document.createElement('div');
    contentArea.className = 'gcp-content';
    contentArea.contentEditable = readOnly ? 'false' : 'true';
    contentArea.spellcheck = true;
    contentArea.innerHTML = initialHtml;
    container.appendChild(contentArea);

    // Comment sidebar
    const commentSidebar = document.createElement('div');
    commentSidebar.className = 'gcp-comment-sidebar';
    commentSidebar.style.display = 'none';
    container.appendChild(commentSidebar);

    // ── Toolbar HTML ───────────────────────────────────────────────────────

    function buildToolbarHtml() {
      return `
        <div class="gcp-toolbar-group">
          <button class="gcp-tb-btn" data-cmd="undo" title="Undo (Ctrl+Z)">↶</button>
          <button class="gcp-tb-btn" data-cmd="redo" title="Redo (Ctrl+Y)">↷</button>
          <span class="gcp-tb-sep"></span>
          <button class="gcp-tb-btn gcp-tb-toggle ${trackChanges ? 'active' : ''}" data-action="toggleTrack" title="Track Changes">
            TC
          </button>
          <button class="gcp-tb-btn" data-action="addComment" title="Add Comment">💬</button>
          <span class="gcp-tb-sep"></span>
          <button class="gcp-tb-btn" data-action="toggleComments" title="Toggle Comments Panel">
            Comments
          </button>
        </div>
      `;
    }

    function buildFormatBarHtml() {
      return `
        <div class="gcp-format-group">
          <button class="gcp-fmt-btn" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>
          <button class="gcp-fmt-btn" data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>
          <button class="gcp-fmt-btn" data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>
          <span class="gcp-tb-sep"></span>
          <button class="gcp-fmt-btn" data-cmd="formatBlock" data-value="H2" title="Heading 2">H2</button>
          <button class="gcp-fmt-btn" data-cmd="formatBlock" data-value="H3" title="Heading 3">H3</button>
          <button class="gcp-fmt-btn" data-cmd="formatBlock" data-value="P" title="Paragraph">¶</button>
          <span class="gcp-tb-sep"></span>
          <button class="gcp-fmt-btn" data-cmd="insertUnorderedList" title="Bullet List">•</button>
          <button class="gcp-fmt-btn" data-cmd="insertOrderedList" title="Numbered List">1.</button>
          <span class="gcp-tb-sep"></span>
          <button class="gcp-fmt-btn" data-cmd="justifyLeft" title="Align Left">⫷</button>
          <button class="gcp-fmt-btn" data-cmd="justifyCenter" title="Align Center">⫸</button>
          <button class="gcp-fmt-btn" data-cmd="justifyRight" title="Align Right">⫹</button>
          <button class="gcp-fmt-btn" data-cmd="justifyFull" title="Justify">☰</button>
          <span class="gcp-tb-sep"></span>
          <select class="gcp-fmt-select" data-cmd="fontName" title="Font">
            <option value="FiraGO">FiraGO</option>
            <option value="Arial">Arial</option>
            <option value="Calibri">Calibri</option>
            <option value="Noto Sans Georgian">Noto Sans</option>
            <option value="Noto Serif Georgian">Noto Serif</option>
            <option value="Sylfaen">Sylfaen</option>
          </select>
          <select class="gcp-fmt-select gcp-fmt-size" data-cmd="fontSize" title="Font Size">
            <option value="1">8</option>
            <option value="2">10</option>
            <option value="3" selected>12</option>
            <option value="4">14</option>
            <option value="5">18</option>
            <option value="6">24</option>
            <option value="7">36</option>
          </select>
          <span class="gcp-tb-sep"></span>
          <input type="color" class="gcp-color-picker" data-cmd="foreColor" value="#1e293b" title="Text Color" />
          <button class="gcp-fmt-btn" data-cmd="removeFormat" title="Clear Formatting">✕</button>
        </div>
      `;
    }

    // ── Format bar events ──────────────────────────────────────────────────

    formatBar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cmd]');
      if (!btn || btn.tagName === 'SELECT' || btn.tagName === 'INPUT') return;
      e.preventDefault();
      contentArea.focus();
      const cmd = btn.dataset.cmd;
      const val = btn.dataset.value || null;

      if (trackChanges && isFormatCommand(cmd)) {
        wrapTrackChange('format');
      }
      document.execCommand(cmd, false, val);
    });

    formatBar.querySelectorAll('select[data-cmd]').forEach(sel => {
      sel.addEventListener('change', () => {
        contentArea.focus();
        document.execCommand(sel.dataset.cmd, false, sel.value);
      });
    });

    formatBar.querySelectorAll('input[type="color"]').forEach(inp => {
      inp.addEventListener('input', () => {
        contentArea.focus();
        document.execCommand(inp.dataset.cmd, false, inp.value);
      });
    });

    function isFormatCommand(cmd) {
      return ['bold', 'italic', 'underline', 'fontName', 'fontSize', 'foreColor',
              'formatBlock', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'].includes(cmd);
    }

    // ── Toolbar actions ────────────────────────────────────────────────────

    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cmd], [data-action]');
      if (!btn) return;
      e.preventDefault();

      if (btn.dataset.cmd) {
        contentArea.focus();
        document.execCommand(btn.dataset.cmd, false, null);
        return;
      }

      const action = btn.dataset.action;
      if (action === 'toggleTrack') {
        trackChanges = !trackChanges;
        btn.classList.toggle('active', trackChanges);
      } else if (action === 'addComment') {
        addCommentAtSelection();
      } else if (action === 'toggleComments') {
        const visible = commentSidebar.style.display !== 'none';
        commentSidebar.style.display = visible ? 'none' : '';
        if (!visible) renderComments();
        if (onCommentsClick) onCommentsClick(!visible);
      }
    });

    // ── Track Changes ──────────────────────────────────────────────────────

    // Intercept keydown for track changes on text input
    contentArea.addEventListener('beforeinput', (e) => {
      if (readOnly || !trackChanges) return;

      if (e.inputType === 'deleteContentBackward' || e.inputType === 'deleteContentForward') {
        const sel = window.getSelection();
        if (!sel.rangeCount) return;

        const range = sel.getRangeAt(0);

        // If there's a selection, wrap it as deleted
        if (!range.collapsed) {
          e.preventDefault();
          wrapSelectionAsDeleted(range);
          return;
        }

        // Single character deletion
        if (e.inputType === 'deleteContentBackward') {
          // Check if previous character is inside an <ins> by the same author
          const node = sel.anchorNode;
          const insEl = node && node.parentElement && node.parentElement.closest('ins[data-author="' + authorName + '"]');
          if (insEl) {
            // Let the browser handle — deleting own insertions is a real delete
            return;
          }
          e.preventDefault();
          // Select the character before cursor and wrap as deleted
          const charRange = document.createRange();
          try {
            if (sel.anchorOffset > 0) {
              charRange.setStart(sel.anchorNode, sel.anchorOffset - 1);
              charRange.setEnd(sel.anchorNode, sel.anchorOffset);
            } else {
              return; // At start of text node
            }
          } catch { return; }
          wrapSelectionAsDeleted(charRange);
        } else if (e.inputType === 'deleteContentForward') {
          const node = sel.anchorNode;
          const insEl = node && node.parentElement && node.parentElement.closest('ins[data-author="' + authorName + '"]');
          if (insEl) return;
          e.preventDefault();
          const charRange = document.createRange();
          try {
            if (sel.anchorNode.length && sel.anchorOffset < sel.anchorNode.length) {
              charRange.setStart(sel.anchorNode, sel.anchorOffset);
              charRange.setEnd(sel.anchorNode, sel.anchorOffset + 1);
            } else {
              return;
            }
          } catch { return; }
          wrapSelectionAsDeleted(charRange);
        }
      } else if (e.inputType === 'insertText' || e.inputType === 'insertParagraph') {
        // Check if we're already inside our own <ins>
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        const node = sel.anchorNode;
        const existingIns = node && (node.nodeType === 3 ? node.parentElement : node);
        if (existingIns && existingIns.closest && existingIns.closest('ins[data-author="' + authorName + '"]')) {
          // Already in our own insertion — let browser handle normally
          return;
        }

        // Wrap new text in an <ins> element
        if (e.inputType === 'insertText' && e.data) {
          e.preventDefault();
          insertTrackedText(e.data);
        }
      }
    });

    function wrapSelectionAsDeleted(range) {
      const contents = range.extractContents();
      const del = document.createElement('del');
      del.setAttribute('data-author', authorName);
      del.setAttribute('data-time', new Date().toISOString());
      del.style.color = color;
      del.style.textDecoration = 'line-through';
      del.style.opacity = '0.7';
      del.appendChild(contents);
      range.insertNode(del);

      // Move cursor after the del
      const newRange = document.createRange();
      newRange.setStartAfter(del);
      newRange.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(newRange);
    }

    function insertTrackedText(text) {
      const sel = window.getSelection();
      if (!sel.rangeCount) return;

      // If selection is non-collapsed, delete first
      const range = sel.getRangeAt(0);
      if (!range.collapsed) {
        wrapSelectionAsDeleted(range);
      }

      const ins = document.createElement('ins');
      ins.setAttribute('data-author', authorName);
      ins.setAttribute('data-time', new Date().toISOString());
      ins.style.color = color;
      ins.style.textDecoration = 'underline';
      ins.textContent = text;

      const r = sel.getRangeAt(0);
      r.insertNode(ins);

      // Move cursor inside ins at end
      const newRange = document.createRange();
      newRange.setStart(ins.firstChild || ins, ins.firstChild ? ins.firstChild.length : 0);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }

    function wrapTrackChange(type) {
      // Format changes are tracked by wrapping the applied formatting change
      // We add a data attribute to the formatted element for attribution
      // This is a lightweight approach — actual implementation would need MutationObserver
    }

    // ── Context menu (insert table) ─────────────────────────────────────────

    contentArea.addEventListener('contextmenu', (e) => {
      if (readOnly) return;
      e.preventDefault();

      // Remove existing context menu
      const existing = container.querySelector('.gcp-context-menu');
      if (existing) existing.remove();

      const menu = document.createElement('div');
      menu.className = 'gcp-context-menu';
      menu.style.left = (e.offsetX) + 'px';
      menu.style.top = (e.offsetY) + 'px';
      menu.innerHTML = `
        <div class="gcp-ctx-item" data-action="insertTable">Insert Table (3×3)</div>
        <div class="gcp-ctx-item" data-action="insertHr">Insert Horizontal Rule</div>
      `;
      contentArea.appendChild(menu);

      menu.addEventListener('click', (ev) => {
        const item = ev.target.closest('[data-action]');
        if (!item) return;
        if (item.dataset.action === 'insertTable') {
          const table = '<table border="1" style="border-collapse:collapse;width:100%;"><tbody>' +
            '<tr><td style="padding:6px;border:1px solid var(--border-color);">&nbsp;</td><td style="padding:6px;border:1px solid var(--border-color);">&nbsp;</td><td style="padding:6px;border:1px solid var(--border-color);">&nbsp;</td></tr>'.repeat(3) +
            '</tbody></table><p><br></p>';
          document.execCommand('insertHTML', false, table);
        } else if (item.dataset.action === 'insertHr') {
          document.execCommand('insertHTML', false, '<hr><p><br></p>');
        }
        menu.remove();
      });

      // Close on click outside
      setTimeout(() => {
        const close = () => { menu.remove(); document.removeEventListener('click', close); };
        document.addEventListener('click', close);
      }, 10);
    });

    // ── Comments ───────────────────────────────────────────────────────────

    function addCommentAtSelection() {
      const sel = window.getSelection();
      if (!sel.rangeCount || sel.isCollapsed) {
        alert('Select some text first to add a comment.');
        return;
      }

      const range = sel.getRangeAt(0);
      const anchorId = uid();

      // Highlight the selected text
      const mark = document.createElement('mark');
      mark.className = 'gcp-comment-anchor';
      mark.dataset.commentId = anchorId;
      mark.style.backgroundColor = 'rgba(255,213,79,0.4)';

      try {
        range.surroundContents(mark);
      } catch {
        // If range crosses element boundaries, use extractContents
        const contents = range.extractContents();
        mark.appendChild(contents);
        range.insertNode(mark);
      }

      // Open inline comment form
      showCommentForm(anchorId, mark);
    }

    function showCommentForm(anchorId, anchorEl) {
      const form = document.createElement('div');
      form.className = 'gcp-comment-form-inline';

      // Position near the anchor
      const rect = anchorEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      form.style.top = (rect.bottom - containerRect.top + 4) + 'px';
      form.style.right = '0';

      form.innerHTML = `
        <div class="gcp-comment-author">
          <span class="gcp-avatar" style="background:${color}">${authorInitials(authorName)}</span>
          <span>${escapeHtml(authorName)}</span>
        </div>
        <textarea class="gcp-comment-input" placeholder="Add a comment..." rows="2"></textarea>
        <div class="gcp-comment-actions">
          <button class="gcp-btn-sm gcp-btn-cancel">Cancel</button>
          <button class="gcp-btn-sm gcp-btn-primary">Add</button>
        </div>
      `;

      container.appendChild(form);
      const textarea = form.querySelector('textarea');
      textarea.focus();

      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { cancelComment(); }
        if (e.key === 'Enter' && e.ctrlKey) { submitComment(); }
      });

      form.querySelector('.gcp-btn-cancel').addEventListener('click', cancelComment);
      form.querySelector('.gcp-btn-primary').addEventListener('click', submitComment);

      function cancelComment() {
        form.remove();
        // Unwrap the mark
        const parent = anchorEl.parentNode;
        while (anchorEl.firstChild) parent.insertBefore(anchorEl.firstChild, anchorEl);
        anchorEl.remove();
      }

      function submitComment() {
        const text = textarea.value.trim();
        if (!text) return;
        comments.push({
          id: anchorId,
          anchorId,
          author: authorName,
          color,
          text,
          time: new Date().toISOString(),
          replies: [],
        });
        form.remove();
        renderComments();
      }
    }

    function renderComments() {
      if (!comments.length) {
        commentSidebar.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:12px;">No comments</p>';
        return;
      }

      commentSidebar.innerHTML = comments.map(c => `
        <div class="gcp-comment-card" data-id="${c.id}">
          <div class="gcp-comment-header">
            <span class="gcp-avatar" style="background:${c.color}">${authorInitials(c.author)}</span>
            <span class="gcp-comment-name">${escapeHtml(c.author)}</span>
            <span class="gcp-comment-time">${new Date(c.time).toLocaleString()}</span>
            <button class="gcp-comment-delete" data-delete="${c.id}" title="Delete">✕</button>
          </div>
          <div class="gcp-comment-text">${escapeHtml(c.text)}</div>
          ${c.replies.map(r => `
            <div class="gcp-comment-reply">
              <span class="gcp-avatar gcp-avatar-sm" style="background:${authorColor(r.author)}">${authorInitials(r.author)}</span>
              <span>${escapeHtml(r.author)}:</span> ${escapeHtml(r.text)}
            </div>
          `).join('')}
          <div class="gcp-reply-form">
            <input class="gcp-reply-input" placeholder="Reply..." data-reply-to="${c.id}" />
          </div>
        </div>
      `).join('');

      // Bind delete
      commentSidebar.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.delete;
          comments = comments.filter(c => c.id !== id);
          // Remove highlight
          const mark = contentArea.querySelector(`[data-comment-id="${id}"]`);
          if (mark) {
            const parent = mark.parentNode;
            while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
            mark.remove();
          }
          renderComments();
          if (onDeleteComment) onDeleteComment(id);
        });
      });

      // Bind reply
      commentSidebar.querySelectorAll('.gcp-reply-input').forEach(input => {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const text = input.value.trim();
            if (!text) return;
            const commentId = input.dataset.replyTo;
            const comment = comments.find(c => c.id === commentId);
            if (comment) {
              const reply = { author: authorName, text, time: new Date().toISOString() };
              comment.replies.push(reply);
              renderComments();
              if (onReplyComment) onReplyComment(commentId, reply);
            }
          }
        });
      });
    }

    // ── Keyboard shortcuts ─────────────────────────────────────────────────

    contentArea.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'b') { e.preventDefault(); document.execCommand('bold'); }
        if (e.key === 'i') { e.preventDefault(); document.execCommand('italic'); }
        if (e.key === 'u') { e.preventDefault(); document.execCommand('underline'); }
      }
    });

    // ── Public API ─────────────────────────────────────────────────────────

    function escapeHtml(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    return {
      getHtml() { return contentArea.innerHTML; },
      setHtml(html) { contentArea.innerHTML = html; },
      getContentElement() { return contentArea; },
      setReadOnly(val) {
        contentArea.contentEditable = val ? 'false' : 'true';
      },
      isTrackChangesEnabled() { return trackChanges; },
      setTrackChanges(val) {
        trackChanges = val;
        const btn = toolbar.querySelector('[data-action="toggleTrack"]');
        if (btn) btn.classList.toggle('active', val);
      },
      setComments(arr) {
        comments = arr || [];
        renderComments();
      },
      getComments() { return comments; },
      focus() { contentArea.focus(); },
      destroy() { container.innerHTML = ''; },
    };
  }

  // ─── SimpleEditor ───────────────────────────────────────────────────────────

  function createSimpleEditor(container, opts = {}) {
    const { placeholder = 'Enter text...' } = opts;
    const id = uid();

    container.innerHTML = '';
    container.classList.add('gcp-simple-root');

    const bar = document.createElement('div');
    bar.className = 'gcp-simple-bar';
    bar.innerHTML = `
      <button class="gcp-fmt-btn" data-cmd="bold" title="Bold"><b>B</b></button>
      <button class="gcp-fmt-btn" data-cmd="italic" title="Italic"><i>I</i></button>
      <button class="gcp-fmt-btn" data-cmd="underline" title="Underline"><u>U</u></button>
      <input type="color" class="gcp-color-picker" data-cmd="foreColor" value="#1e293b" title="Text Color" />
    `;
    container.appendChild(bar);

    const area = document.createElement('div');
    area.className = 'gcp-simple-content';
    area.contentEditable = 'true';
    area.setAttribute('data-placeholder', placeholder);
    container.appendChild(area);

    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cmd]');
      if (!btn || btn.tagName === 'INPUT') return;
      e.preventDefault();
      area.focus();
      document.execCommand(btn.dataset.cmd, false, null);
    });

    bar.querySelector('input[type="color"]').addEventListener('input', (e) => {
      area.focus();
      document.execCommand('foreColor', false, e.target.value);
    });

    return {
      getHtml() { return area.innerHTML; },
      setHtml(html) { area.innerHTML = html; },
      focus() { area.focus(); },
      destroy() { container.innerHTML = ''; },
    };
  }

  return { RichEditor, createSimpleEditor, authorColor, authorInitials };
})();
