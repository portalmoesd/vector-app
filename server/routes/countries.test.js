const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const countriesRouter = require('./countries');

function findRoute(method, path) {
  const layer = countriesRouter.stack.find(
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

test('GET /api/countries requires authentication before lookup', async () => {
  const handlers = findRoute('GET', '/');
  const calls = [];

  await withMockDbQuery(
    async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
    async () => {
      const req = { headers: {} };
      const res = mockResponse();

      await runHandlers(handlers, req, res);

      assert.equal(res.statusCode, 401);
      assert.equal(res.body.error, 'Authentication required');
      assert.equal(calls.length, 0);
    }
  );
});

test('GET /api/countries maps country rows for clients', async () => {
  const handlers = findRoute('GET', '/');
  const calls = [];

  await withMockDbQuery(
    async (sql, params) => {
      calls.push({ sql, params });
      assert.match(sql, /SELECT id, name_en, code FROM countries ORDER BY name_en/);
      return {
        rows: [
          { id: 1, name_en: 'Georgia', code: 'GE' },
          { id: 2, name_en: 'France', code: 'FR' },
        ],
      };
    },
    async () => {
      const req = {
        headers: { authorization: authHeader({ id: 7, role: 'COLLABORATOR' }) },
      };
      const res = mockResponse();

      await runHandlers(handlers, req, res);

      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, [
        { id: 1, nameEn: 'Georgia', code: 'GE' },
        { id: 2, nameEn: 'France', code: 'FR' },
      ]);
      assert.equal(calls.length, 1);
    }
  );
});
