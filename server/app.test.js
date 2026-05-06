const test = require('node:test');
const assert = require('node:assert/strict');
const createApp = require('./app');
const db = require('./db');
const securityHeaders = require('./middleware/security-headers');

function findRoute(app, method, path) {
  return app._router.stack.find(
    (layer) => layer.route && layer.route.path === path && layer.route.methods[method.toLowerCase()]
  );
}

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
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

async function withMockDbQuery(mockQuery, fn) {
  const originalQuery = db.query;
  db.query = mockQuery;
  try {
    await fn();
  } finally {
    db.query = originalQuery;
  }
}

test('health endpoint is registered and returns deployment status', () => {
  const app = createApp();
  const route = findRoute(app, 'GET', '/api/health');
  assert.ok(route, 'GET /api/health route should be registered');

  const res = mockResponse();
  route.route.stack[0].handle({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.service, 'vector-portal');
  assert.ok(res.body.timestamp);
});

test('readiness endpoint confirms database connectivity', async () => {
  const app = createApp();
  const route = findRoute(app, 'GET', '/api/ready');
  assert.ok(route, 'GET /api/ready route should be registered');

  await withMockDbQuery(
    async (sql) => {
      assert.equal(sql, 'SELECT 1');
      return { rows: [{ '?column?': 1 }] };
    },
    async () => {
      const res = mockResponse();
      await route.route.stack[0].handle({}, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.database, true);
    }
  );
});

test('readiness endpoint reports unavailable database', async () => {
  const app = createApp();
  const route = findRoute(app, 'GET', '/api/ready');

  await withMockDbQuery(
    async () => {
      throw new Error('database unavailable');
    },
    async () => {
      const res = mockResponse();
      await route.route.stack[0].handle({}, res);

      assert.equal(res.statusCode, 503);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.database, false);
    }
  );
});

test('security headers middleware sets browser hardening headers', () => {
  const res = mockResponse();
  let nextCalled = false;

  securityHeaders({}, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(res.headers['permissions-policy'], 'camera=(), microphone=(), geolocation=()');
});
