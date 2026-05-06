const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const historyRouter = require('./history');

function findRoute(method, path) {
  const layer = historyRouter.stack.find(
    (item) => item.route && item.route.path === path && item.route.methods[method.toLowerCase()]
  );
  assert.ok(layer, `${method} ${path} should be registered`);
  return layer.route.stack.map((item) => item.handle);
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

function createHistoryQueryMock(overrides = {}) {
  const calls = [];
  async function query(sql, params) {
    calls.push({ sql, params });
    if (/SELECT 1\s+FROM events e\s+JOIN sections s/.test(sql)) {
      return { rows: overrides.forbidden ? [] : [{ '?column?': 1 }] };
    }
    if (/FROM section_history/.test(sql)) {
      return {
        rows: [
          {
            id: 1,
            action: 'SUBMIT',
            from_status: 'DRAFT',
            to_status: 'SUBMITTED_TO_SUPERVISOR',
            user_name: 'Nino',
            user_role: 'COLLABORATOR',
            note: 'Ready',
            acted_at: '2026-04-01T10:00:00.000Z',
          },
        ],
      };
    }
    throw new Error(`Unexpected history query: ${sql}`);
  }
  return { query, calls };
}

test('GET /api/workflow/section-history validates section id before access lookup', async () => {
  const handlers = findRoute('GET', '/section-history');
  const mock = createHistoryQueryMock();

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, role: 'COLLABORATOR' }) },
      query: { event_id: '10', section_id: 'bad' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'section_id must be a positive integer');
    assert.equal(mock.calls.length, 0);
  });
});

test('GET /api/workflow/section-history blocks inaccessible sections', async () => {
  const handlers = findRoute('GET', '/section-history');
  const mock = createHistoryQueryMock({ forbidden: true });

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, role: 'COLLABORATOR' }) },
      query: { event_id: '10', section_id: '20' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'Not authorized to access this section');
  });
});

test('GET /api/workflow/section-history returns mapped section history', async () => {
  const handlers = findRoute('GET', '/section-history');
  const mock = createHistoryQueryMock();

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, role: 'COLLABORATOR' }) },
      query: { event_id: '10', section_id: '20' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      history: [
        {
          id: 1,
          action: 'SUBMIT',
          fromStatus: 'DRAFT',
          toStatus: 'SUBMITTED_TO_SUPERVISOR',
          userName: 'Nino',
          userRole: 'COLLABORATOR',
          note: 'Ready',
          actedAt: '2026-04-01T10:00:00.000Z',
        },
      ],
    });
  });
});
