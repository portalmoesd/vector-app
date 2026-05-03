const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const authRouter = require('./auth');

function findRoute(method, path) {
  const layer = authRouter.stack.find((item) => (
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
    headers: {},
    set(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
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

test('POST /login rejects invalid username format before database lookup', async () => {
  const handlers = findRoute('POST', '/login');
  const calls = [];

  await withMockDbQuery(async (...args) => {
    calls.push(args);
    return { rows: [] };
  }, async () => {
    const req = {
      ip: 'auth-invalid-username',
      headers: {},
      body: { username: 'ab', password: 'password123' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /username must be 3-100/);
    assert.equal(calls.length, 0);
  });
});

test('POST /login returns invalid credentials for unknown or wrong-password users', async () => {
  const handlers = findRoute('POST', '/login');

  await withMockDbQuery(async () => ({ rows: [] }), async () => {
    const req = {
      ip: 'auth-unknown-user',
      headers: {},
      body: { username: 'missing.user', password: 'password123' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'Invalid credentials');
  });

  const hash = await bcrypt.hash('correct-password', 10);
  await withMockDbQuery(async () => ({
    rows: [{
      id: 7,
      full_name: 'Wrong Password',
      username: 'wrong.password',
      email: 'wrong@example.test',
      password_hash: hash,
      role: 'SUPERVISOR',
      department_id: 5,
      department_name: 'Department',
      is_external: false,
      entity_name: null,
      must_change_password: false,
    }],
  }), async () => {
    const req = {
      ip: 'auth-wrong-password',
      headers: {},
      body: { username: 'wrong.password', password: 'bad-password' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'Invalid credentials');
  });
});

test('POST /login normalizes username and returns token plus user payload', async () => {
  const handlers = findRoute('POST', '/login');
  const hash = await bcrypt.hash('password123', 10);
  const calls = [];

  await withMockDbQuery(async (sql, params) => {
    calls.push({ sql, params });
    return {
      rows: [{
        id: 9,
        full_name: 'Login User',
        username: 'login.user',
        email: 'login@example.test',
        password_hash: hash,
        role: 'DEPUTY',
        department_id: 3,
        department_name: 'Deputies',
        is_external: false,
        entity_name: null,
        must_change_password: true,
      }],
    };
  }, async () => {
    const req = {
      ip: 'auth-success',
      headers: {},
      body: { username: ' Login.User ', password: 'password123' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls[0].params, ['login.user']);
    const decoded = jwt.verify(res.body.token, config.jwtSecret);
    assert.equal(decoded.id, 9);
    assert.equal(decoded.username, 'login.user');
    assert.equal(decoded.role, 'DEPUTY');
    assert.equal(res.body.user.fullName, 'Login User');
    assert.equal(res.body.user.mustChangePassword, true);
  });
});

test('POST /change-password enforces new password length before database lookup', async () => {
  const handlers = findRoute('POST', '/change-password');
  const calls = [];

  await withMockDbQuery(async (...args) => {
    calls.push(args);
    return { rows: [] };
  }, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, username: 'user', role: 'SUPERVISOR' }) },
      body: { currentPassword: 'old-password', newPassword: 'short' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'newPassword must be at least 8 characters');
    assert.equal(calls.length, 0);
  });
});

test('POST /change-password updates hash and clears must-change flag', async () => {
  const handlers = findRoute('POST', '/change-password');
  const oldHash = await bcrypt.hash('old-password', 10);
  const calls = [];

  await withMockDbQuery(async (sql, params) => {
    calls.push({ sql, params });
    if (/SELECT password_hash/.test(sql)) {
      return { rows: [{ password_hash: oldHash }] };
    }
    if (/UPDATE users SET password_hash/.test(sql)) {
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected auth query: ${sql}`);
  }, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, username: 'user', role: 'SUPERVISOR' }) },
      body: { currentPassword: 'old-password', newPassword: 'new-password' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true });
    const update = calls.find(call => /UPDATE users SET password_hash/.test(call.sql));
    assert.ok(update, 'password update should run');
    assert.equal(update.params[1], 7);
    assert.equal(await bcrypt.compare('new-password', update.params[0]), true);
  });
});
