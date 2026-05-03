const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const filesRouter = require('./files');

function findRoute(method, path) {
  const layer = filesRouter.stack.find((item) => (
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
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    set(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    send(payload) {
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

function createFileQueryMock(overrides = {}) {
  const calls = [];
  const file = {
    id: 12,
    event_id: 10,
    section_id: 20,
    original_name: 'ანგარიში 2026.pdf',
    mime_type: 'application/pdf',
    file_data: Buffer.from('file-bytes'),
    uploaded_by_id: 7,
    ...overrides.file,
  };

  async function query(sql, params) {
    calls.push({ sql, params });

    if (/SELECT id, event_id, section_id, original_name/.test(sql)) {
      return { rows: overrides.missingFile ? [] : [file] };
    }
    if (/SELECT event_id, section_id, uploaded_by_id/.test(sql)) {
      return { rows: overrides.missingFile ? [] : [file] };
    }
    if (/SELECT 1\s+FROM events e\s+JOIN sections s/.test(sql)) {
      return { rows: overrides.forbidden ? [] : [{ '?column?': 1 }] };
    }
    if (/DELETE FROM section_files/.test(sql)) {
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unexpected files query: ${sql}`);
  }

  return { query, calls, file };
}

test('GET /download streams accessible files with safe UTF-8 filename headers', async () => {
  const handlers = findRoute('GET', '/download');
  const mock = createFileQueryMock();

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, username: 'user', role: 'COLLABORATOR', departmentId: 5 }) },
      query: { id: '12' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.match(res.headers['content-disposition'], /filename="\_\_\_\_\_\_\_\_ 2026\.pdf"/);
    assert.match(res.headers['content-disposition'], /filename\*=UTF-8''/);
    assert.deepEqual(res.body, mock.file.file_data);
  });
});

test('GET /download rejects invalid ids before querying files', async () => {
  const handlers = findRoute('GET', '/download');
  const mock = createFileQueryMock();

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, username: 'user', role: 'COLLABORATOR', departmentId: 5 }) },
      query: { id: 'bad' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'id must be a positive integer');
    assert.equal(mock.calls.length, 0);
  });
});

test('GET /download blocks users without section access', async () => {
  const handlers = findRoute('GET', '/download');
  const mock = createFileQueryMock({ forbidden: true });

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 8, username: 'other', role: 'COLLABORATOR', departmentId: 9 }) },
      query: { id: '12' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'Not authorized to access this file');
    assert.equal(res.body instanceof Buffer, false);
  });
});

test('POST /delete allows the uploader to delete an accessible file', async () => {
  const handlers = findRoute('POST', '/delete');
  const mock = createFileQueryMock();

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, username: 'user', role: 'COLLABORATOR', departmentId: 5 }) },
      body: { id: 12 },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true });
    const deleteCall = mock.calls.find(call => /DELETE FROM section_files/.test(call.sql));
    assert.ok(deleteCall, 'file row should be deleted');
    assert.deepEqual(deleteCall.params, [12]);
  });
});

test('POST /delete blocks non-uploaders who are not admins', async () => {
  const handlers = findRoute('POST', '/delete');
  const mock = createFileQueryMock({ file: { uploaded_by_id: 7 } });

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 8, username: 'other', role: 'SUPERVISOR', departmentId: 5 }) },
      body: { id: 12 },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'Not authorized to delete this file');
    assert.equal(mock.calls.some(call => /DELETE FROM section_files/.test(call.sql)), false);
  });
});
