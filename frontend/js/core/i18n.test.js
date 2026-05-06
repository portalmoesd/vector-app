const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Minimal browser-global shims
// ---------------------------------------------------------------------------
globalThis.localStorage = {
  _store: {},
  getItem(k) { return this._store[k] ?? null; },
  setItem(k, v) { this._store[k] = String(v); },
};
globalThis.window = { location: { origin: 'http://localhost:3000' } };
globalThis.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.console = globalThis.console || {};

// Stub fetch — load locale files from disk
globalThis.fetch = async (url) => {
  const locale = url.replace(/^\/locales\//, '').replace(/\.json$/, '');
  const filePath = path.join(__dirname, '..', '..', 'locales', `${locale}.json`);
  const text = fs.readFileSync(filePath, 'utf8');
  return {
    json: async () => JSON.parse(text),
  };
};

// ---------------------------------------------------------------------------
// Load i18n.js — it uses `const I18n` and `function t()`, so we wrap the
// eval to capture them as globals.
// ---------------------------------------------------------------------------
const src = fs.readFileSync(path.join(__dirname, 'i18n.js'), 'utf8');
// Replace `const I18n` with a globalThis assignment so it survives eval scope
const patchedSrc = src
  .replace(/^const I18n\b/m, 'globalThis.I18n')
  .replace(/^function t\b/m, 'globalThis.t = function');
eval(patchedSrc);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('I18n.t()', () => {
  before(async () => {
    await globalThis.I18n.load('en');
  });

  it('resolves a simple key', () => {
    assert.equal(globalThis.I18n.t('auth.login'), 'Log In');
  });

  it('resolves a deeply nested key', () => {
    assert.equal(globalThis.I18n.t('calendar.tabs.upcoming'), 'Upcoming');
  });

  it('returns the key itself when not found', () => {
    assert.equal(globalThis.I18n.t('nonexistent.key'), 'nonexistent.key');
  });

  it('substitutes parameters', () => {
    assert.equal(
      globalThis.I18n.t('dashboard.confirmApproveAll', { n: 5 }),
      'Approve all 5 sections',
    );
  });

  it('handles multiple parameter replacements', () => {
    assert.equal(
      globalThis.I18n.t('editor.status.sectionOf', { n: 2, total: 10 }),
      'Section 2 of 10',
    );
  });

  it('returns key for null path segment', () => {
    assert.equal(globalThis.I18n.t('auth.nonexistent'), 'auth.nonexistent');
  });
});

describe('I18n.tr()', () => {
  before(async () => {
    await globalThis.I18n.load('en');
  });

  it('is an alias for t()', () => {
    assert.equal(globalThis.I18n.tr('common.save'), globalThis.I18n.t('common.save'));
    assert.equal(globalThis.I18n.tr('common.save'), 'Save');
  });
});

describe('I18n.getLocale()', () => {
  before(async () => {
    await globalThis.I18n.load('en');
  });

  it('returns the current locale', () => {
    assert.equal(globalThis.I18n.getLocale(), 'en');
  });
});

describe('I18n.load()', () => {
  it('switches locale and persists to localStorage', async () => {
    await globalThis.I18n.load('en');
    assert.equal(globalThis.I18n.getLocale(), 'en');
    assert.equal(globalThis.localStorage.getItem('locale'), 'en');
  });
});

describe('global t() helper', () => {
  before(async () => {
    await globalThis.I18n.load('en');
  });

  it('delegates to I18n.t()', () => {
    assert.equal(globalThis.t('common.cancel'), 'Cancel');
  });
});
