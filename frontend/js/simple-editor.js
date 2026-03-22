/**
 * simple-editor.js — Lightweight rich-text editor for the Task field.
 *
 * Toolbar: Bold, Italic, Underline, Color palette.
 * Default font size: 11pt. Preserves line breaks.
 *
 * Usage:
 *   const editor = window.GCP.createSimpleEditor(containerEl, { placeholder: '...' });
 *   editor.getHtml();   // get content
 *   editor.setHtml(h);  // set content
 *   editor.clear();     // reset
 */
(function () {
  'use strict';

  var cssInjected = false;
  function injectCss() {
    if (cssInjected) return;
    cssInjected = true;
    var style = document.createElement('style');
    style.textContent = [
      '.se-wrap{border:1px solid rgba(43,68,91,.14);border-radius:14px;background:rgba(255,255,255,.96);overflow:hidden;}',
      '.se-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:2px;padding:6px 8px;border-bottom:1px solid rgba(43,68,91,.10);background:rgba(245,247,250,.85);}',
      '.se-toolbar button{background:none;border:none;cursor:pointer;padding:4px 7px;border-radius:6px;font-size:13px;font-weight:700;color:#22395a;line-height:1;min-width:28px;min-height:28px;display:inline-flex;align-items:center;justify-content:center;}',
      '.se-toolbar button:hover{background:rgba(43,68,91,.10);}',
      '.se-toolbar button.active{background:rgba(43,68,91,.18);}',
      '.se-sep{width:1px;height:20px;background:rgba(43,68,91,.12);margin:0 4px;}',
      /* Color button */
      '.se-color-wrap{position:relative;}',
      '.se-color-btn{display:inline-flex;align-items:center;gap:3px;background:none;border:none;cursor:pointer;padding:4px 7px;border-radius:6px;font-size:13px;font-weight:700;color:#22395a;min-height:28px;}',
      '.se-color-btn:hover{background:rgba(43,68,91,.10);}',
      '.se-color-swatch{width:14px;height:14px;border-radius:3px;border:1px solid rgba(0,0,0,.12);flex-shrink:0;}',
      '.se-color-btn svg{width:10px;height:10px;margin-left:1px;opacity:.5;}',
      /* Palette popup */
      '.se-palette{display:none;position:absolute;top:100%;left:0;z-index:50;margin-top:4px;padding:8px;background:#fff;border:1px solid rgba(43,68,91,.14);border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.12);grid-template-columns:repeat(6,1fr);gap:4px;}',
      '.se-palette.open{display:grid;}',
      '.se-palette button{width:24px;height:24px;min-width:24px;min-height:24px;padding:0;border:2px solid transparent;border-radius:5px;cursor:pointer;transition:border-color .15s,transform .1s;}',
      '.se-palette button:hover{border-color:rgba(43,68,91,.35);transform:scale(1.15);}',
      '.se-palette button.sel{border-color:#0a84ff;}',
      /* Body */
      '.se-body{min-height:180px;max-height:400px;overflow-y:auto;padding:12px 16px;font-size:11pt;font-weight:500;line-height:1.65;color:#22395a;outline:none;white-space:pre-wrap;word-wrap:break-word;}',
      '.se-body:empty::before{content:attr(data-placeholder);color:rgba(43,68,91,.35);pointer-events:none;font-weight:500;}',
    ].join('\n');
    document.head.appendChild(style);
  }

  var COLORS = [
    '#22395a', '#000000', '#4a4a4a', '#7f8c8d',
    '#c0392b', '#e74c3c', '#e67e22', '#f39c12',
    '#27ae60', '#2ecc71', '#2980b9', '#3498db',
    '#8e44ad', '#9b59b6', '#1abc9c', '#16a085',
    '#d35400', '#e84393', '#6c5ce7', '#00b894',
    '#fd79a8', '#a29bfe', '#fdcb6e', '#636e72',
  ];

  function createSimpleEditor(container, opts) {
    opts = opts || {};
    injectCss();

    var wrap = document.createElement('div');
    wrap.className = 'se-wrap';

    // -- Toolbar --
    var toolbar = document.createElement('div');
    toolbar.className = 'se-toolbar';

    function addBtn(label, title, cmd) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML = label;
      btn.title = title;
      btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
      btn.addEventListener('click', function () {
        document.execCommand(cmd, false, null);
        body.focus();
        updateActive();
      });
      toolbar.appendChild(btn);
      return btn;
    }

    var boldBtn = addBtn('<b>B</b>', 'Bold', 'bold');
    var italicBtn = addBtn('<i>I</i>', 'Italic', 'italic');
    var underlineBtn = addBtn('<u>U</u>', 'Underline', 'underline');

    // Separator
    var sep = document.createElement('span');
    sep.className = 'se-sep';
    toolbar.appendChild(sep);

    // -- Color palette button --
    var currentColor = '#22395a';
    var colorWrap = document.createElement('span');
    colorWrap.className = 'se-color-wrap';

    var colorBtn = document.createElement('button');
    colorBtn.type = 'button';
    colorBtn.className = 'se-color-btn';
    colorBtn.title = 'Text color';
    var swatch = document.createElement('span');
    swatch.className = 'se-color-swatch';
    swatch.style.background = currentColor;
    colorBtn.appendChild(document.createTextNode('A'));
    colorBtn.appendChild(swatch);
    // dropdown arrow
    var arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrow.setAttribute('viewBox', '0 0 10 10');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M2 3.5L5 6.5L8 3.5');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    arrow.appendChild(path);
    colorBtn.appendChild(arrow);
    colorWrap.appendChild(colorBtn);

    // Palette popup
    var palette = document.createElement('div');
    palette.className = 'se-palette';
    COLORS.forEach(function (c) {
      var cb = document.createElement('button');
      cb.type = 'button';
      cb.style.background = c;
      cb.title = c;
      if (c === currentColor) cb.classList.add('sel');
      cb.addEventListener('mousedown', function (e) { e.preventDefault(); });
      cb.addEventListener('click', function () {
        currentColor = c;
        swatch.style.background = c;
        palette.querySelectorAll('button').forEach(function (b) { b.classList.remove('sel'); });
        cb.classList.add('sel');
        document.execCommand('foreColor', false, c);
        palette.classList.remove('open');
        body.focus();
      });
      palette.appendChild(cb);
    });
    colorWrap.appendChild(palette);

    colorBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    colorBtn.addEventListener('click', function () {
      palette.classList.toggle('open');
    });

    // Close palette on outside click
    document.addEventListener('mousedown', function (e) {
      if (!colorWrap.contains(e.target)) {
        palette.classList.remove('open');
      }
    });

    toolbar.appendChild(colorWrap);
    wrap.appendChild(toolbar);

    // -- Body (contenteditable) --
    var body = document.createElement('div');
    body.className = 'se-body';
    body.contentEditable = 'true';
    body.setAttribute('data-placeholder', opts.placeholder || 'Enter task description...');
    wrap.appendChild(body);

    container.appendChild(wrap);

    // -- Active state tracking --
    function updateActive() {
      boldBtn.classList.toggle('active', document.queryCommandState('bold'));
      italicBtn.classList.toggle('active', document.queryCommandState('italic'));
      underlineBtn.classList.toggle('active', document.queryCommandState('underline'));
    }
    body.addEventListener('keyup', updateActive);
    body.addEventListener('mouseup', updateActive);

    // -- API --
    return {
      getHtml: function () {
        return body.innerHTML.replace(/(<br\s*\/?>|\s|&nbsp;)*$/, '').trim();
      },
      setHtml: function (html) {
        body.innerHTML = html || '';
      },
      clear: function () {
        body.innerHTML = '';
      },
      focus: function () {
        body.focus();
      },
      el: body
    };
  }

  if (!window.GCP) window.GCP = {};
  window.GCP.createSimpleEditor = createSimpleEditor;
})();
