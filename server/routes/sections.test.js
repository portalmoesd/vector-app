const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const sectionsRouter = require('./sections');

function findRoute(method, path) {
  const layer = sectionsRouter.stack.find((item) => (
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

function createSectionsQueryMock(overrides = {}) {
  const calls = [];
  async function query(sql, params) {
    calls.push({ sql, params });
    if (/SELECT 1\s+FROM events e\s+WHERE e.id/.test(sql)) {
      return { rows: overrides.forbidden ? [] : [{ '?column?': 1 }] };
    }
    if (/SELECT s.id, s.title, s.sort_order/.test(sql)) {
      return {
        rows: [
          { id: 20, title: 'Summary', sort_order: 1, department_ids: [3, null, 4] },
          { id: 21, title: 'Details', sort_order: 2, department_ids: [5] },
        ],
      };
    }
    if (/SELECT event_id FROM sections/.test(sql)) {
      return { rows: overrides.missingSection ? [] : [{ event_id: 10 }] };
    }
    if (/SELECT 1\s+FROM events e\s+JOIN sections s/.test(sql)) {
      return { rows: overrides.sectionForbidden ? [] : [{ '?column?': 1 }] };
    }
    if (/UPDATE sections SET title/.test(sql)) {
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected sections query: ${sql}`);
  }
  return { query, calls };
}

test('GET /api/sections validates event id before access lookup', async () => {
  const handlers = findRoute('GET', '/');
  const mock = createSectionsQueryMock();

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, role: 'COLLABORATOR' }) },
      query: { event_id: 'bad' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'event_id must be a positive integer');
    assert.equal(mock.calls.length, 0);
  });
});

test('GET /api/sections returns accessible sections with department ids', async () => {
  const handlers = findRoute('GET', '/');
  const mock = createSectionsQueryMock();

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, role: 'COLLABORATOR' }) },
      query: { event_id: '10' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, [
      { id: 20, title: 'Summary', sortOrder: 1, departmentIds: [3, 4] },
      { id: 21, title: 'Details', sortOrder: 2, departmentIds: [5] },
    ]);
  });
});

test('PATCH /api/sections/:id/label rejects read-only analysts before lookup', async () => {
  const handlers = findRoute('PATCH', '/:id/label');
  const mock = createSectionsQueryMock();

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, role: 'ANALYST' }) },
      params: { id: '20' },
      body: { title: 'Updated' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'Read-only role');
    assert.equal(mock.calls.length, 0);
  });
});

test('PATCH /api/sections/:id/label trims and updates accessible section title', async () => {
  const handlers = findRoute('PATCH', '/:id/label');
  const mock = createSectionsQueryMock();

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, role: 'SUPERVISOR' }) },
      params: { id: '20' },
      body: { title: ' Updated title ' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true });
    const update = mock.calls.find(call => /UPDATE sections SET title/.test(call.sql));
    assert.deepEqual(update.params, ['Updated title', 20]);
  });
});
