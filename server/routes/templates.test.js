const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const templatesRouter = require('./templates');

function findRoute(method, path) {
  const layer = templatesRouter.stack.find((item) => (
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

function createTemplateTransactionMock() {
  const calls = [];
  let sectionId = 300;
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (/INSERT INTO event_templates/.test(sql)) return { rows: [{ id: 80 }] };
      if (/INSERT INTO event_template_sections/.test(sql)) {
        sectionId += 1;
        return { rows: [{ id: sectionId }] };
      }
      if (/INSERT INTO event_template_section_departments/.test(sql)) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected template transaction query: ${sql}`);
    },
    releaseCalled: false,
    release() {
      this.releaseCalled = true;
    },
  };
  return { client, calls };
}

test('POST /api/templates rejects analyst mutation before transaction', async () => {
  const handlers = findRoute('POST', '/');
  const tx = createTemplateTransactionMock();

  await withMockDb(async () => ({ rows: [] }), async () => tx.client, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 5, username: 'analyst', role: 'ANALYST' }) },
      body: { name: 'Blocked template' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'Read-only role');
    assert.equal(tx.calls.length, 0);
  });
});

test('POST /api/templates validates sections before opening transaction', async () => {
  const handlers = findRoute('POST', '/');
  const tx = createTemplateTransactionMock();

  await withMockDb(async () => ({ rows: [] }), async () => tx.client, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, username: 'creator', role: 'SUPERVISOR' }) },
      body: { name: 'Bad template', sections: [{ title: ' ', departmentIds: [1] }] },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'section title is required');
    assert.equal(tx.calls.length, 0);
  });
});

test('POST /api/templates creates sections and department links transactionally', async () => {
  const handlers = findRoute('POST', '/');
  const tx = createTemplateTransactionMock();

  await withMockDb(async () => ({ rows: [] }), async () => tx.client, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, username: 'creator', role: 'SUPERVISOR' }) },
      body: {
        name: 'Country briefing',
        documentSubmitterRole: 'SUPERVISOR',
        curatorRequired: true,
        sections: [
          { title: 'Trade', departmentIds: [1, 2, 2] },
          { title: 'Investment', departmentIds: [] },
        ],
      },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body, { id: 80, success: true });
    assert.equal(tx.calls[0].sql, 'BEGIN');
    assert.equal(tx.calls.at(-1).sql, 'COMMIT');
    assert.equal(tx.client.releaseCalled, true);

    const templateInsert = tx.calls.find(call => /INSERT INTO event_templates/.test(call.sql));
    assert.deepEqual(templateInsert.params, ['Country briefing', 7, 'SUPERVISOR', true]);
    assert.equal(tx.calls.filter(call => /INSERT INTO event_template_sections/.test(call.sql)).length, 2);
    assert.equal(tx.calls.filter(call => /INSERT INTO event_template_section_departments/.test(call.sql)).length, 2);
  });
});

test('DELETE /api/templates/:id validates template id before database delete', async () => {
  const handlers = findRoute('DELETE', '/:id');
  const calls = [];

  await withMockDb(async (...args) => {
    calls.push(args);
    return { rows: [], rowCount: 0 };
  }, async () => ({ query: async () => ({ rows: [] }), release() {} }), async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, username: 'creator', role: 'SUPERVISOR' }) },
      params: { id: 'bad' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'id must be a positive integer');
    assert.equal(calls.length, 0);
  });
});
