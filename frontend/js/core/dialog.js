/**
 * GCP.ActionDialog — styled replacements for window.confirm() and window.prompt().
 *
 * Usage:
 *   const ok = await GCP.ActionDialog.confirm('Approve section', {
 *     confirmLabel: 'Approve', confirmColor: '#16a34a',
 *   });
 *
 *   const text = await GCP.ActionDialog.prompt('Return section', {
 *     placeholder: 'Add a comment (optional)...',
 *     confirmLabel: 'Return', confirmColor: '#6d28d9',
 *     required: false,
 *   });
 *   // text === null means user cancelled
 */
window.GCP = window.GCP || {};

GCP.ActionDialog = (() => {
  let overlay, card, title, body, cancelBtn, confirmBtn, textarea;
  let _resolve = null;

  function ensureDOM() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'none';

    card = document.createElement('div');
    card.className = 'modal-card';

    title = document.createElement('h3');

    body = document.createElement('div');

    textarea = document.createElement('textarea');
    textarea.className = 'action-dialog__textarea';

    const footer = document.createElement('div');
    footer.className = 'modal-footer';

    cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-outline';
    cancelBtn.textContent = 'Cancel';

    confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn';

    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);

    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(footer);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });

    cancelBtn.addEventListener('click', () => close(null));

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.style.display !== 'none') close(null);
    });
  }

  function close(value) {
    overlay.style.display = 'none';
    if (_resolve) {
      _resolve(value);
      _resolve = null;
    }
  }

  function show(titleText, opts, mode) {
    ensureDOM();

    title.textContent = titleText;
    confirmBtn.textContent = opts.confirmLabel || 'Confirm';
    confirmBtn.style.background = opts.confirmColor || '#3b82f6';
    confirmBtn.style.color = '#fff';
    confirmBtn.style.border = 'none';

    if (mode === 'prompt') {
      textarea.value = '';
      textarea.placeholder = opts.placeholder || '';
      body.appendChild(textarea);
      body.style.display = '';

      if (opts.required) {
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = '0.5';
        textarea.oninput = () => {
          const hasText = textarea.value.trim().length > 0;
          confirmBtn.disabled = !hasText;
          confirmBtn.style.opacity = hasText ? '1' : '0.5';
        };
      } else {
        confirmBtn.disabled = false;
        confirmBtn.style.opacity = '1';
        textarea.oninput = null;
      }
    } else {
      // confirm mode — hide textarea
      if (textarea.parentNode === body) body.removeChild(textarea);
      confirmBtn.disabled = false;
      confirmBtn.style.opacity = '1';
    }

    overlay.style.display = 'flex';

    if (mode === 'prompt') textarea.focus();

    return new Promise((resolve) => {
      _resolve = resolve;

      confirmBtn.onclick = () => {
        if (mode === 'prompt') {
          close(textarea.value);
        } else {
          close(true);
        }
      };
    });
  }

  return {
    confirm(titleText, opts = {}) {
      return show(titleText, opts, 'confirm');
    },
    prompt(titleText, opts = {}) {
      return show(titleText, opts, 'prompt');
    },
  };
})();
