const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const adminRouter = require('./admin');

function findRoute(method, path) {
  const layer = adminRouter.stack.find(
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

function createAdminLinkQueryMock(overrides = {}) {
  const calls = [];
  async function query(sql, params) {
    calls.push({ sql, params });

    if (/role = 'DEPUTY'/.test(sql)) {
      return { rows: overrides.invalidDeputy ? [] : [{ id: params[0] }] };
    }
    if (/role = 'SUPERVISOR'/.test(sql)) {
      return { rows: overrides.invalidSupervisor ? [] : [{ id: params[0] }] };
    }
    if (/INSERT INTO deputy_supervisor_links/.test(sql)) {
      return { rows: [{ id: 55 }] };
    }
    if (/DELETE FROM deputy_supervisor_links/.test(sql)) {
      return { rows: [], rowCount: overrides.deleteMissing ? 0 : 1 };
    }

    throw new Error(`Unexpected admin query: ${sql}`);
  }
  return { query, calls };
}

test('POST /deputy-supervisor-links rejects invalid ids before lookup', async () => {
  const handlers = findRoute('POST', '/deputy-supervisor-links');
  const mock = createAdminLinkQueryMock();

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 1, username: 'admin', role: 'ADMIN' }) },
      body: { deputyId: 'bad', supervisorId: 20 },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'deputyId must be a positive integer');
    assert.equal(mock.calls.length, 0);
  });
});

test('POST /deputy-supervisor-links validates linked user roles', async () => {
  const handlers = findRoute('POST', '/deputy-supervisor-links');
  const mock = createAdminLinkQueryMock({ invalidSupervisor: true });

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 1, username: 'admin', role: 'ADMIN' }) },
      body: { deputyId: 10, supervisorId: 20 },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 422);
    assert.equal(res.body.error, 'Invalid supervisor user');
    assert.equal(
      mock.calls.some((call) => /INSERT INTO deputy_supervisor_links/.test(call.sql)),
      false
    );
  });
});

test('POST /deputy-supervisor-links creates valid links', async () => {
  const handlers = findRoute('POST', '/deputy-supervisor-links');
  const mock = createAdminLinkQueryMock();

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 1, username: 'admin', role: 'ADMIN' }) },
      body: { deputyId: 10, supervisorId: 20 },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body, { id: 55, success: true });
    const insert = mock.calls.find((call) => /INSERT INTO deputy_supervisor_links/.test(call.sql));
    assert.deepEqual(insert.params, [10, 20]);
  });
});

test('DELETE /deputy-supervisor-links/:id returns 404 for missing links', async () => {
  const handlers = findRoute('DELETE', '/deputy-supervisor-links/:id');
  const mock = createAdminLinkQueryMock({ deleteMissing: true });

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 1, username: 'admin', role: 'ADMIN' }) },
      params: { id: 55 },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'Link not found');
  });
});
