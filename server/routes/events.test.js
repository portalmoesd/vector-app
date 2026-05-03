const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const eventsRouter = require('./events');

function findRoute(method, path) {
  const layer = eventsRouter.stack.find((item) => (
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

function authHeader(user) {
  const token = jwt.sign(user, config.jwtSecret, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

async function withMockDb(mockQuery, mockConnect, fn) {
  const originalQuery = db.query;
  const originalConnect = db.pool.connect;
  db.query = mockQuery;
  db.pool.connect = mockConnect;
  try {
    await fn();
  } finally {
    db.query = originalQuery;
    db.pool.connect = originalConnect;
  }
}

function validCreateBody(overrides = {}) {
  return {
    title: 'Ministerial briefing',
    countryId: 1,
    documentSubmitterRole: 'DEPUTY',
    documentSubmitterId: 99,
    deputyId: 99,
    supervisorId: null,
    curatorRequired: false,
    language: 'EN',
    deadlineDate: '2026-05-20',
    occasion: '<p>Prepare country brief.</p>',
    workflowType: 'simple',
    sections: [
      { title: 'Trade', departmentIds: [5, 6] },
      { title: 'Investment', departmentIds: [7] },
    ],
    ...overrides,
  };
}

function createEventsQueryMock(overrides = {}) {
  const calls = [];

  async function query(sql, params) {
    calls.push({ sql, params });

    if (/SELECT id, role FROM users/.test(sql)) {
      return {
        rows: overrides.documentSubmitterRows || [{ id: params[0], role: overrides.documentSubmitterRole || 'DEPUTY' }],
      };
    }
    if (/SELECT id FROM users WHERE id = \$1 AND role = 'DEPUTY'/.test(sql)) {
      return { rows: overrides.deputyRows || [{ id: params[0] }] };
    }
    if (/SELECT id FROM users WHERE id = \$1 AND role = 'SUPERVISOR'/.test(sql)) {
      return { rows: overrides.supervisorRows || [{ id: params[0] }] };
    }

    throw new Error(`Unexpected events query: ${sql}`);
  }

  return { query, calls };
}

function createTransactionMock() {
  const calls = [];
  let sectionId = 200;
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });

      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (/INSERT INTO events/.test(sql)) {
        return { rows: [{ id: 100 }] };
      }
      if (/INSERT INTO sections/.test(sql)) {
        sectionId += 1;
        return { rows: [{ id: sectionId }] };
      }
      if (/INSERT INTO section_departments/.test(sql)) {
        return { rows: [], rowCount: 1 };
      }
      if (/INSERT INTO section_content/.test(sql)) {
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected transaction query: ${sql}`);
    },
    releaseCalled: false,
    release() {
      this.releaseCalled = true;
    },
  };
  return { client, calls };
}

test('POST /api/events rejects document submitter role mismatches', async () => {
  const handlers = findRoute('POST', '/');
  const queryMock = createEventsQueryMock({ documentSubmitterRole: 'SUPERVISOR' });
  const tx = createTransactionMock();

  await withMockDb(queryMock.query, async () => tx.client, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 1, username: 'admin', role: 'ADMIN' }) },
      body: validCreateBody(),
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 422);
    assert.equal(res.body.error, 'Document submitter does not match the selected role');
    assert.equal(tx.calls.length, 0);
  });
});

test('POST /api/events requires responsible supervisor for advanced deputy workflows', async () => {
  const handlers = findRoute('POST', '/');
  const queryMock = createEventsQueryMock();
  const tx = createTransactionMock();

  await withMockDb(queryMock.query, async () => tx.client, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 1, username: 'admin', role: 'ADMIN' }) },
      body: validCreateBody({ workflowType: 'advanced', supervisorId: null }),
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'supervisorId is required for advanced deputy workflows');
    assert.equal(tx.calls.length, 0);
  });
});

test('POST /api/events creates simple event sections in one transaction', async () => {
  const handlers = findRoute('POST', '/');
  const queryMock = createEventsQueryMock();
  const tx = createTransactionMock();

  await withMockDb(queryMock.query, async () => tx.client, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 1, username: 'admin', role: 'ADMIN' }) },
      body: validCreateBody({ supervisorId: 55 }),
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body, { id: 100, success: true });
    assert.equal(tx.calls[0].sql, 'BEGIN');
    assert.equal(tx.calls.at(-1).sql, 'COMMIT');
    assert.equal(tx.client.releaseCalled, true);

    const eventInsert = tx.calls.find(call => /INSERT INTO events/.test(call.sql));
    assert.ok(eventInsert, 'event should be inserted');
    assert.deepEqual(eventInsert.params, [
      'Ministerial briefing',
      1,
      'DEPUTY',
      99,
      99,
      null,
      false,
      'simple',
      'EN',
      '2026-05-20',
      '<p>Prepare country brief.</p>',
      1,
    ]);

    assert.equal(tx.calls.filter(call => /INSERT INTO sections/.test(call.sql)).length, 2);
    assert.equal(tx.calls.filter(call => /INSERT INTO section_departments/.test(call.sql)).length, 3);
    assert.equal(tx.calls.filter(call => /INSERT INTO section_content/.test(call.sql)).length, 2);
  });
});
