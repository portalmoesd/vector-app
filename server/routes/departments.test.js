const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const departmentsRouter = require('./departments');

function findRoute(method, path) {
  const layer = departmentsRouter.stack.find((item) => (
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

test('POST /api/departments rejects non-admin users before database insert', async () => {
  const handlers = findRoute('POST', '/');
  const calls = [];

  await withMockDbQuery(async (...args) => {
    calls.push(args);
    return { rows: [] };
  }, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 9, username: 'supervisor', role: 'SUPERVISOR' }) },
      body: { name: 'Internal', nameEn: 'Internal', isExternal: false },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'Insufficient permissions');
    assert.equal(calls.length, 0);
  });
});

test('POST /api/departments validates required name before insert', async () => {
  const handlers = findRoute('POST', '/');
  const calls = [];

  await withMockDbQuery(async (...args) => {
    calls.push(args);
    return { rows: [] };
  }, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 1, username: 'admin', role: 'ADMIN' }) },
      body: { name: ' ', nameEn: 'No name', isExternal: false },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'name is required');
    assert.equal(calls.length, 0);
  });
});

test('POST /api/departments normalizes optional English name and boolean flag', async () => {
  const handlers = findRoute('POST', '/');
  const calls = [];

  await withMockDbQuery(async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: 15 }] };
  }, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 1, username: 'admin', role: 'ADMIN' }) },
      body: { name: '  External Entity  ', nameEn: '', isExternal: 'yes' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body, { id: 15, success: true });
    assert.deepEqual(calls[0].params, ['External Entity', null, true]);
  });
});
