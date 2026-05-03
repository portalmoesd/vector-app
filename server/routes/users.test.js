const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const usersRouter = require('./users');

function findRoute(method, path) {
  const layer = usersRouter.stack.find((item) => (
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

async function withMockPoolConnect(mockConnect, fn) {
  const originalConnect = db.pool.connect;
  db.pool.connect = mockConnect;
  try {
    await fn();
  } finally {
    db.pool.connect = originalConnect;
  }
}

function createUserTransactionMock() {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });

      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (/INSERT INTO users/.test(sql)) {
        return { rows: [{ id: 42 }] };
      }
      if (/INSERT INTO country_assignments/.test(sql)) {
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected users transaction query: ${sql}`);
    },
    releaseCalled: false,
    release() {
      this.releaseCalled = true;
    },
  };
  return { client, calls };
}

function validUserBody(overrides = {}) {
  return {
    fullName: 'External Partner',
    username: 'Partner.User',
    email: 'PARTNER@example.test',
    password: 'password123',
    role: 'COLLABORATOR',
    departmentId: 5,
    isExternal: true,
    entityName: 'World Bank',
    countryIds: [1, 2, 2],
    ...overrides,
  };
}

test('POST /api/users rejects non-admin callers before opening a transaction', async () => {
  const handlers = findRoute('POST', '/');
  const tx = createUserTransactionMock();

  await withMockPoolConnect(async () => tx.client, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 8, username: 'supervisor', role: 'SUPERVISOR' }) },
      body: validUserBody(),
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'Insufficient permissions');
    assert.equal(tx.calls.length, 0);
  });
});

test('POST /api/users validates account identifiers before opening a transaction', async () => {
  const handlers = findRoute('POST', '/');
  const tx = createUserTransactionMock();

  await withMockPoolConnect(async () => tx.client, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 1, username: 'admin', role: 'ADMIN' }) },
      body: validUserBody({ email: 'not-email' }),
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'email must be a valid email address');
    assert.equal(tx.calls.length, 0);
  });
});

test('POST /api/users normalizes external users and deduplicates country assignments', async () => {
  const handlers = findRoute('POST', '/');
  const tx = createUserTransactionMock();

  await withMockPoolConnect(async () => tx.client, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 1, username: 'admin', role: 'ADMIN' }) },
      body: validUserBody(),
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body, { id: 42, success: true });
    assert.equal(tx.calls[0].sql, 'BEGIN');
    assert.equal(tx.calls.at(-1).sql, 'COMMIT');
    assert.equal(tx.client.releaseCalled, true);

    const insert = tx.calls.find(call => /INSERT INTO users/.test(call.sql));
    assert.ok(insert, 'user insert should run');
    assert.equal(insert.params[0], 'External Partner');
    assert.equal(insert.params[1], 'partner.user');
    assert.equal(insert.params[2], 'partner@example.test');
    assert.equal(await bcrypt.compare('password123', insert.params[3]), true);
    assert.equal(insert.params[4], 'COLLABORATOR');
    assert.equal(insert.params[5], null);
    assert.equal(insert.params[6], true);
    assert.equal(insert.params[7], 'World Bank');

    const countryInserts = tx.calls.filter(call => /INSERT INTO country_assignments/.test(call.sql));
    assert.deepEqual(countryInserts.map(call => call.params), [[42, 1], [42, 2]]);
  });
});

test('POST /api/users clears entity name for internal users', async () => {
  const handlers = findRoute('POST', '/');
  const tx = createUserTransactionMock();

  await withMockPoolConnect(async () => tx.client, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 1, username: 'admin', role: 'ADMIN' }) },
      body: validUserBody({
        isExternal: false,
        departmentId: 9,
        entityName: 'Should disappear',
        countryIds: [],
      }),
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 201);
    const insert = tx.calls.find(call => /INSERT INTO users/.test(call.sql));
    assert.equal(insert.params[5], 9);
    assert.equal(insert.params[6], false);
    assert.equal(insert.params[7], null);
    assert.equal(tx.calls.some(call => /INSERT INTO country_assignments/.test(call.sql)), false);
  });
});
