const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const commentsRouter = require('./comments');

function findRoute(method, path) {
  const layer = commentsRouter.stack.find(
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

function createCommentQueryMock(overrides = {}) {
  const calls = [];
  async function query(sql, params) {
    calls.push({ sql, params });
    if (/SELECT 1\s+FROM events e\s+JOIN sections s/.test(sql)) {
      return { rows: overrides.forbidden ? [] : [{ '?column?': 1 }] };
    }
    if (/INSERT INTO section_comments/.test(sql)) {
      return { rows: [{ id: 88 }] };
    }
    if (/UPDATE section_content/.test(sql)) {
      return { rows: [], rowCount: 1 };
    }
    if (/DELETE FROM section_comments/.test(sql)) {
      return { rows: [], rowCount: overrides.deleteMissing ? 0 : 1 };
    }
    throw new Error(`Unexpected comments query: ${sql}`);
  }
  return { query, calls };
}

test('POST /api/workflow/comments validates content before access lookup', async () => {
  const handlers = findRoute('POST', '/');
  const mock = createCommentQueryMock();

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, username: 'user', role: 'COLLABORATOR', departmentId: 5 }) },
      body: { eventId: 10, sectionId: 20, content: ' ' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'content is required');
    assert.equal(mock.calls.length, 0);
  });
});

test('POST /api/workflow/comments inserts comment and autosaves editor HTML', async () => {
  const handlers = findRoute('POST', '/');
  const mock = createCommentQueryMock();

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, username: 'user', role: 'COLLABORATOR', departmentId: 5 }) },
      body: {
        eventId: 10,
        sectionId: 20,
        parentId: '',
        anchorId: ' note-1 ',
        content: ' Please revise ',
        htmlContent: '<p id="note-1">Text</p>',
      },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body, { id: 88, success: true });
    const insert = mock.calls.find((call) => /INSERT INTO section_comments/.test(call.sql));
    assert.deepEqual(insert.params, [10, 20, 7, null, 'note-1', 'Please revise']);
    const update = mock.calls.find((call) => /UPDATE section_content/.test(call.sql));
    assert.deepEqual(update.params, ['<p id="note-1">Text</p>', 7, 10, 20]);
  });
});

test('POST /api/workflow/comments/delete returns 404 when comment is not owned by user', async () => {
  const handlers = findRoute('POST', '/delete');
  const mock = createCommentQueryMock({ deleteMissing: true });

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, username: 'user', role: 'COLLABORATOR', departmentId: 5 }) },
      body: { commentId: 99 },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'Comment not found');
  });
});
