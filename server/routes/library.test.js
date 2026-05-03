const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const libraryRouter = require('./library');

function findRoute(method, path) {
  const layer = libraryRouter.stack.find((item) => (
    item.route
    && item.route.path === path
    && item.route.methods[method.toLowerCase()]
  ));
  assert.ok(layer, `${method} ${path} should be registered`);
  return layer.route.stack.map(item => item.handle);
}

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function runHandlers(handlers, req, res) {
  for (const handler of handlers) {
    let nextCalled = false;
    await handler(req, res, () => {
      nextCalled = true;
    });
    if (!nextCalled) break;
  }
}

async function withMockDbQuery(mockQuery, fn) {
  const originalQuery = db.query;
  db.query = mockQuery;
  try {
    await fn();
  } finally {
    db.query = originalQuery;
  }
}

function authHeader(user) {
  const token = jwt.sign(user, config.jwtSecret, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

function createLibraryQueryMock(overrides = {}) {
  const calls = [];
  async function query(sql, params) {
    calls.push({ sql, params });
    if (/SELECT 1\s+FROM events e\s+WHERE e.id/.test(sql)) {
      return { rows: overrides.forbidden ? [] : [{ '?column?': 1 }] };
    }
    if (/SELECT e.title, e.language/.test(sql)) {
      return {
        rows: overrides.missingDocument ? [] : [{
          title: 'Published brief',
          language: 'EN',
          ended_at: '2026-05-01',
          country_name: 'France',
        }],
      };
    }
    if (/SELECT s.id, s.title/.test(sql)) {
      return { rows: [{ id: 20, title: 'Trade', sort_order: 0, html_content: '<p>Done</p>' }] };
    }
    if (/SELECT document_submitter_id, status FROM events/.test(sql)) {
      return {
        rows: overrides.missingEvent ? [] : [{
          document_submitter_id: overrides.documentSubmitterId ?? 7,
          status: overrides.status || 'COMPLETED',
        }],
      };
    }
    if (/UPDATE events/.test(sql)) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected library query: ${sql}`);
  }
  return { query, calls };
}

test('GET /api/library/:eventId/document validates event id before access lookup', async () => {
  const handlers = findRoute('GET', '/:eventId/document');
  const mock = createLibraryQueryMock();

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, username: 'user', role: 'SUPERVISOR' }) },
      params: { eventId: 'bad' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'eventId must be a positive integer');
    assert.equal(mock.calls.length, 0);
  });
});

test('GET /api/library/:eventId/document returns completed document sections', async () => {
  const handlers = findRoute('GET', '/:eventId/document');
  const mock = createLibraryQueryMock();

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, username: 'user', role: 'SUPERVISOR' }) },
      params: { eventId: 10 },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.eventId, 10);
    assert.equal(res.body.title, 'Published brief');
    assert.deepEqual(res.body.sections, [{ id: 20, title: 'Trade', sortOrder: 0, htmlContent: '<p>Done</p>' }]);
  });
});

test('POST /api/library/:eventId/reopen blocks non-document-submitters', async () => {
  const handlers = findRoute('POST', '/:eventId/reopen');
  const mock = createLibraryQueryMock({ documentSubmitterId: 7 });

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 8, username: 'other', role: 'SUPERVISOR' }) },
      params: { eventId: 10 },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'Only the Document Submitter can reopen a published event');
    assert.equal(mock.calls.some(call => /UPDATE events/.test(call.sql)), false);
  });
});

test('POST /api/library/:eventId/reopen reactivates completed events for document submitter', async () => {
  const handlers = findRoute('POST', '/:eventId/reopen');
  const mock = createLibraryQueryMock({ documentSubmitterId: 7 });

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, username: 'ds', role: 'DEPUTY' }) },
      params: { eventId: 10 },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true });
    const update = mock.calls.find(call => /UPDATE events/.test(call.sql));
    assert.deepEqual(update.params, [10]);
  });
});
