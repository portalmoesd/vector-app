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

  /**
   * Show an inline popover anchored to a button (desktop).
   * Falls back to the modal prompt on narrow viewports (≤600px).
   *
   * @param {HTMLElement} anchorBtn – the button to anchor to
   * @param {string} titleText
   * @param {object} opts – same as prompt() opts
   * @returns {Promise<string|null>}
   */
  function popoverPrompt(anchorBtn, titleText, opts = {}) {
    // Mobile fallback
    if (window.innerWidth <= 600) {
      return show(titleText, opts, 'prompt');
    }

    return new Promise((resolve) => {
      // Remove any existing popover
      document.querySelectorAll('.action-popover').forEach(el => el.remove());

      const pop = document.createElement('div');
      pop.className = 'action-popover';

      // Fixed positioning mode: anchor to an inline element via bounding rect
      if (opts.fixed) {
        const rect = anchorBtn.getBoundingClientRect();
        pop.style.position = 'fixed';
        pop.style.top = (rect.bottom + 6) + 'px';
        pop.style.left = rect.left + 'px';
        pop.style.right = 'auto';
        document.body.appendChild(pop);
      } else {
        const wrapper = anchorBtn.closest('.dp-section-row__actions') || anchorBtn.parentElement;
        wrapper.style.position = 'relative';
        wrapper.appendChild(pop);
      }

      const heading = document.createElement('div');
      heading.className = 'action-popover__title';
      heading.textContent = titleText;

      const ta = document.createElement('textarea');
      ta.className = 'action-popover__textarea';
      ta.placeholder = opts.placeholder || '';

      const footer = document.createElement('div');
      footer.className = 'action-popover__footer';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn-outline';
      cancelBtn.textContent = 'Cancel';

      const okBtn = document.createElement('button');
      okBtn.className = 'btn';
      okBtn.textContent = opts.confirmLabel || 'Confirm';
      okBtn.style.background = opts.confirmColor || '#3b82f6';
      okBtn.style.color = '#fff';
      okBtn.style.border = 'none';

      if (opts.required) {
        okBtn.disabled = true;
        okBtn.style.opacity = '0.5';
        ta.addEventListener('input', () => {
          const has = ta.value.trim().length > 0;
          okBtn.disabled = !has;
          okBtn.style.opacity = has ? '1' : '0.5';
        });
      }

      footer.appendChild(cancelBtn);
      footer.appendChild(okBtn);
      pop.appendChild(heading);
      pop.appendChild(ta);
      pop.appendChild(footer);
      ta.focus();

      function cleanup(value) {
        pop.remove();
        document.removeEventListener('keydown', onKey);
        resolve(value);
      }

      function onKey(e) {
        if (e.key === 'Escape') cleanup(null);
      }

      document.addEventListener('keydown', onKey);
      cancelBtn.addEventListener('click', () => cleanup(null));
      okBtn.addEventListener('click', () => cleanup(ta.value));
    });
  }

  return {
    confirm(titleText, opts = {}) {
      return show(titleText, opts, 'confirm');
    },
    prompt(titleText, opts = {}) {
      return show(titleText, opts, 'prompt');
    },
    popoverPrompt,
  };
})();
