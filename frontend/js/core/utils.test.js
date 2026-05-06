const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Minimal browser-global shims
// ---------------------------------------------------------------------------

// escapeHtml() uses document.createElement('div'), sets .textContent, reads
// .innerHTML.  We replicate just enough of that contract.
function makeElement() {
  let text = '';
  return {
    style: {},
    set textContent(v) {
      text = String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    },
    get innerHTML() {
      return text;
    },
    appendChild() {},
  };
}

globalThis.document = {
  createElement: () => makeElement(),
  querySelector: () => null,
  querySelectorAll: () => [],
  body: { appendChild() {} },
};

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.window = { location: { origin: 'http://localhost:3000' } };
globalThis.requestAnimationFrame = (cb) => cb();

// Provide a stub I18n so _i18n() falls back to its hardcoded fallback map
globalThis.I18n = { t: (k) => k, getLocale: () => 'en' };

// ---------------------------------------------------------------------------
// Load utils.js (sets global functions via plain script execution)
// ---------------------------------------------------------------------------
const utilsSrc = fs.readFileSync(
  path.join(__dirname, 'utils.js'),
  'utf8',
);
eval(utilsSrc);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('escapeHtml', () => {
  it('escapes <script> tags', () => {
    assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes double quotes', () => {
    assert.equal(escapeHtml('"quotes"'), '&quot;quotes&quot;');
  });

  it('escapes ampersands', () => {
    assert.equal(escapeHtml('a & b'), 'a &amp; b');
  });

  it('escapes single quotes', () => {
    assert.equal(escapeHtml("it's"), "it&#039;s");
  });

  it('passes through normal text unchanged', () => {
    assert.equal(escapeHtml('hello world'), 'hello world');
  });

  it('returns empty string for empty input', () => {
    assert.equal(escapeHtml(''), '');
  });
});

describe('formatDate', () => {
  it('formats an ISO date string', () => {
    const result = formatDate('2024-03-15T10:30:00Z');
    // en-GB locale → dd/mm/yyyy
    assert.ok(result.includes('2024'), `expected year in "${result}"`);
    assert.ok(result.includes('03') || result.includes('3'), `expected month in "${result}"`);
    assert.ok(result.includes('15'), `expected day in "${result}"`);
  });

  it('returns dash for null', () => {
    assert.equal(formatDate(null), '—');
  });

  it('returns dash for undefined', () => {
    assert.equal(formatDate(undefined), '—');
  });

  it('returns dash for empty string', () => {
    assert.equal(formatDate(''), '—');
  });
});

describe('statusLabel', () => {
  it('returns Draft for "draft"', () => {
    // _i18n will try I18n.t('status.draft') which returns the key itself,
    // so it falls back to the hardcoded 'Draft'
    assert.equal(statusLabel('draft'), 'Draft');
  });

  it('returns label for submitted_to_supervisor', () => {
    assert.equal(statusLabel('submitted_to_supervisor'), 'At Supervisor');
  });

  it('returns label for approved_by_deputy', () => {
    assert.equal(statusLabel('approved_by_deputy'), 'Approved (Deputy)');
  });

  it('returns Draft for null', () => {
    assert.equal(statusLabel(null), 'Draft');
  });

  it('returns Draft for undefined', () => {
    assert.equal(statusLabel(undefined), 'Draft');
  });

  it('returns the raw status for unknown values', () => {
    assert.equal(statusLabel('unknown_status'), 'unknown_status');
  });
});

describe('statusClass', () => {
  it('returns status-draft for draft', () => {
    assert.equal(statusClass('draft'), 'status-draft');
  });

  it('returns status-draft for null/undefined', () => {
    assert.equal(statusClass(null), 'status-draft');
    assert.equal(statusClass(undefined), 'status-draft');
  });

  it('returns status-submitted for submitted_to_supervisor', () => {
    assert.equal(statusClass('submitted_to_supervisor'), 'status-submitted');
  });

  it('returns status-returned for returned_by_deputy', () => {
    assert.equal(statusClass('returned_by_deputy'), 'status-returned');
  });

  it('returns status-approved for approved_by_supervisor', () => {
    assert.equal(statusClass('approved_by_supervisor'), 'status-approved');
  });

  it('returns empty string for unknown status', () => {
    assert.equal(statusClass('something_else'), '');
  });
});

describe('roleLabel', () => {
  it('returns Collaborator for COLLABORATOR', () => {
    assert.equal(roleLabel('COLLABORATOR'), 'Collaborator');
  });

  it('returns Supervisor for SUPERVISOR', () => {
    assert.equal(roleLabel('SUPERVISOR'), 'Supervisor');
  });

  it('returns Deputy for DEPUTY', () => {
    assert.equal(roleLabel('DEPUTY'), 'Deputy');
  });

  it('returns Admin for ADMIN', () => {
    assert.equal(roleLabel('ADMIN'), 'Admin');
  });

  it('returns Super-Collaborator for SUPER_COLLABORATOR', () => {
    assert.equal(roleLabel('SUPER_COLLABORATOR'), 'Super-Collaborator');
  });

  it('returns Analyst for ANALYST', () => {
    assert.equal(roleLabel('ANALYST'), 'Analyst');
  });

  it('returns the raw role for unknown values', () => {
    assert.equal(roleLabel('UNKNOWN_ROLE'), 'UNKNOWN_ROLE');
  });
});

describe('dashboardUrl', () => {
  it('maps COLLABORATOR to dashboard-collab', () => {
    assert.equal(dashboardUrl('COLLABORATOR'), '/pages/dashboard-collab.html');
  });

  it('maps SUPER_COLLABORATOR to dashboard-super-collab', () => {
    assert.equal(dashboardUrl('SUPER_COLLABORATOR'), '/pages/dashboard-super-collab.html');
  });

  it('maps SUPERVISOR to dashboard-supervisor', () => {
    assert.equal(dashboardUrl('SUPERVISOR'), '/pages/dashboard-supervisor.html');
  });

  it('maps DEPUTY to dashboard-deputy', () => {
    assert.equal(dashboardUrl('DEPUTY'), '/pages/dashboard-deputy.html');
  });

  it('maps ADMIN to admin page', () => {
    assert.equal(dashboardUrl('ADMIN'), '/pages/admin.html');
  });

  it('maps PROTOCOL to calendar', () => {
    assert.equal(dashboardUrl('PROTOCOL'), '/pages/calendar.html');
  });

  it('maps ANALYST to statistics', () => {
    assert.equal(dashboardUrl('ANALYST'), '/pages/statistics.html');
  });

  it('defaults unknown roles to dashboard-collab', () => {
    assert.equal(dashboardUrl('UNKNOWN'), '/pages/dashboard-collab.html');
  });
});

describe('languageLabel', () => {
  it('returns English for EN', () => {
    assert.equal(languageLabel('EN'), 'English');
  });

  it('returns the code for unknown language', () => {
    assert.equal(languageLabel('FR'), 'FR');
  });
});

describe('formatDateTime', () => {
  it('returns dash for falsy input', () => {
    assert.equal(formatDateTime(null), '—');
    assert.equal(formatDateTime(''), '—');
  });

  it('formats a date-time string', () => {
    const result = formatDateTime('2024-06-01T14:30:00Z');
    assert.ok(result.includes('2024'), `expected year in "${result}"`);
  });
});
