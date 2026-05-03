const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const workflowRouter = require('./workflow');

function findRoute(method, path) {
  const layer = workflowRouter.stack.find((item) => (
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

function createWorkflowQueryMock(overrides = {}) {
  const calls = [];
  const event = {
    id: 10,
    document_submitter_role: 'DEPUTY',
    document_submitter_id: 99,
    deputy_id: 99,
    supervisor_id: null,
    curator_required: false,
    workflow_type: 'advanced',
    country_id: 1,
    event_status: 'IN_PROGRESS',
    ...overrides.event,
  };
  const sectionContent = {
    status: 'draft',
    original_submitter_role: null,
    return_target_role: null,
    last_updated_by_user_id: null,
    ...overrides.sectionContent,
  };

  async function query(sql, params) {
    calls.push({ sql, params });

    if (/SELECT id, document_submitter_role/.test(sql)) {
      return { rows: overrides.missingEvent ? [] : [event] };
    }
    if (/SELECT status, original_submitter_role/.test(sql)) {
      return { rows: overrides.missingSectionContent ? [] : [sectionContent] };
    }
    if (/SELECT 1\s+FROM events e\s+JOIN sections s/.test(sql)) {
      return { rows: overrides.forbidden ? [] : [{ '?column?': 1 }] };
    }
    if (/SELECT full_name, department_id FROM users/.test(sql)) {
      return { rows: [{ full_name: overrides.fullName || 'Test User', department_id: overrides.userDepartmentId || 5 }] };
    }
    if (/SELECT department_id FROM users/.test(sql)) {
      return { rows: [{ department_id: overrides.dsDepartmentId || 5 }] };
    }
    if (/SELECT department_id FROM section_departments/.test(sql)) {
      return { rows: (overrides.sectionDepartmentIds || [5]).map(department_id => ({ department_id })) };
    }
    if (/UPDATE section_content/.test(sql)) return { rows: [], rowCount: 1 };
    if (/UPDATE events SET status = 'IN_PROGRESS'/.test(sql)) return { rows: [], rowCount: 1 };
    if (/INSERT INTO section_history/.test(sql)) return { rows: [], rowCount: 1 };
    if (/DELETE FROM section_return_requests/.test(sql)) return { rows: [], rowCount: 1 };
    if (/SELECT workflow_type, status FROM events/.test(sql)) {
      return { rows: [{ workflow_type: event.workflow_type, status: event.event_status }] };
    }
    if (/SELECT status FROM section_content WHERE event_id/.test(sql)) {
      return { rows: overrides.completionSections || [] };
    }
    if (/UPDATE events\s+SET status = 'COMPLETED'/.test(sql)) return { rows: [], rowCount: 1 };

    throw new Error(`Unexpected query in workflow test: ${sql}`);
  }

  return { query, calls };
}

test('POST /submit rejects a user who is not the current section holder', async () => {
  const handlers = findRoute('POST', '/submit');
  const mock = createWorkflowQueryMock({
    sectionContent: { status: 'submitted_to_super_collaborator' },
  });

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, username: 'collab', role: 'COLLABORATOR', departmentId: 5 }) },
      body: { eventId: 10, sectionId: 20 },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 403);
    assert.match(res.body.error, /Section is held by SUPER_COLLABORATOR/);
    assert.equal(mock.calls.some(call => /UPDATE section_content/.test(call.sql)), false);
  });
});

test('POST /submit advances a draft section to the next workflow holder', async () => {
  const handlers = findRoute('POST', '/submit');
  const mock = createWorkflowQueryMock();

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, username: 'collab', role: 'COLLABORATOR', departmentId: 5 }) },
      body: { eventId: 10, sectionId: 20 },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true, newStatus: 'submitted_to_super_collaborator' });
    const update = mock.calls.find(call => /UPDATE section_content/.test(call.sql));
    assert.ok(update, 'section_content should be updated');
    assert.deepEqual(update.params, ['submitted_to_super_collaborator', 'COLLABORATOR', 7, 10, 20]);
    assert.equal(mock.calls.some(call => /INSERT INTO section_history/.test(call.sql)), true);
    assert.equal(mock.calls.some(call => /DELETE FROM section_return_requests/.test(call.sql)), true);
  });
});

test('POST /submit rejects invalid identifiers before loading workflow context', async () => {
  const handlers = findRoute('POST', '/submit');
  const mock = createWorkflowQueryMock();

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, username: 'collab', role: 'COLLABORATOR', departmentId: 5 }) },
      body: { eventId: 'bad', sectionId: 20 },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'eventId must be a positive integer');
    assert.equal(mock.calls.length, 0);
  });
});

test('POST /approve rejects a section that is not submitted to the user role', async () => {
  const handlers = findRoute('POST', '/approve');
  const mock = createWorkflowQueryMock({
    sectionContent: { status: 'draft' },
  });

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 7, username: 'collab', role: 'COLLABORATOR', departmentId: 5 }) },
      body: { eventId: 10, sectionId: 20, comment: 'Looks good' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Cannot approve/);
    assert.equal(mock.calls.some(call => /UPDATE section_content/.test(call.sql)), false);
  });
});

test('POST /approve advances a submitted section to the next holder', async () => {
  const handlers = findRoute('POST', '/approve');
  const mock = createWorkflowQueryMock({
    sectionContent: {
      status: 'submitted_to_super_collaborator',
      original_submitter_role: 'COLLABORATOR',
    },
  });

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 8, username: 'sc', role: 'SUPER_COLLABORATOR', departmentId: 5 }) },
      body: { eventId: 10, sectionId: 20, comment: 'Approved' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true, newStatus: 'submitted_to_supervisor' });
    const update = mock.calls.find(call => /UPDATE section_content/.test(call.sql));
    assert.ok(update, 'section_content should be updated');
    assert.deepEqual(update.params, ['submitted_to_supervisor', 'Approved', 8, 10, 20]);
    const history = mock.calls.find(call => /INSERT INTO section_history/.test(call.sql));
    assert.ok(history, 'section_history should be inserted');
    assert.deepEqual(history.params, [10, 20, 'submitted_to_super_collaborator', 'submitted_to_supervisor', 8, 'Test User', 'SUPER_COLLABORATOR', 'Approved']);
  });
});

test('POST /approve lets the document submitter finalize an amendment', async () => {
  const handlers = findRoute('POST', '/approve');
  const mock = createWorkflowQueryMock({
    event: {
      document_submitter_role: 'DEPUTY',
      document_submitter_id: 99,
      deputy_id: 99,
      workflow_type: 'simple',
    },
    sectionContent: {
      status: 'submitted_to_amending_ds',
      original_submitter_role: 'COLLABORATOR',
    },
    completionSections: [{ status: 'approved_by_ds_amendment' }],
  });

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 99, username: 'deputy', role: 'DEPUTY', departmentId: 5 }) },
      body: { eventId: 10, sectionId: 20, comment: 'Amendment approved' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true, newStatus: 'approved_by_ds_amendment' });
    const update = mock.calls.find(call => /UPDATE section_content/.test(call.sql));
    assert.deepEqual(update.params, ['approved_by_ds_amendment', 'Amendment approved', 99, 10, 20]);
    const history = mock.calls.find(call => /INSERT INTO section_history/.test(call.sql));
    assert.deepEqual(history.params, [10, 20, 'submitted_to_amending_ds', 'approved_by_ds_amendment', 99, 'Test User', 'AMENDING_DS', 'Amendment approved']);
  });
});

test('POST /return sends submitted sections back to the first editor role', async () => {
  const handlers = findRoute('POST', '/return');
  const mock = createWorkflowQueryMock({
    sectionContent: {
      status: 'submitted_to_super_collaborator',
      original_submitter_role: 'COLLABORATOR',
    },
  });

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 8, username: 'sc', role: 'SUPER_COLLABORATOR', departmentId: 5 }) },
      body: { eventId: 10, sectionId: 20, comment: 'Please revise' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      success: true,
      newStatus: 'returned_by_super_collaborator',
      returnTargetRole: 'COLLABORATOR',
    });
    const update = mock.calls.find(call => /UPDATE section_content/.test(call.sql));
    assert.deepEqual(update.params, ['returned_by_super_collaborator', 'Please revise', 'COLLABORATOR', 8, 10, 20]);
  });
});

test('POST /return rejects document submitter amendment sections', async () => {
  const handlers = findRoute('POST', '/return');
  const mock = createWorkflowQueryMock({
    event: {
      document_submitter_id: 99,
      workflow_type: 'simple',
    },
    sectionContent: {
      status: 'submitted_to_amending_ds',
      original_submitter_role: 'COLLABORATOR',
    },
  });

  await withMockDbQuery(mock.query, async () => {
    const req = {
      headers: { authorization: authHeader({ id: 99, username: 'deputy', role: 'DEPUTY', departmentId: 5 }) },
      body: { eventId: 10, sectionId: 20, comment: 'Back' },
    };
    const res = mockResponse();

    await runHandlers(handlers, req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Cannot return an amendment/);
    assert.equal(mock.calls.some(call => /UPDATE section_content/.test(call.sql)), false);
  });
});
