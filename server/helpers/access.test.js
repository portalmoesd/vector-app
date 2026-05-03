const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const { canAccessEvent, canAccessSection } = require('./access');

async function withMockQuery(mockQuery, fn) {
  const originalQuery = db.query;
  db.query = mockQuery;
  try {
    await fn();
  } finally {
    db.query = originalQuery;
  }
}

test('canAccessEvent allows admin-like roles without querying', async () => {
  await withMockQuery(
    async () => {
      throw new Error('admin access should not query');
    },
    async () => {
      assert.equal(await canAccessEvent({ id: 1, role: 'ADMIN' }, 10), true);
      assert.equal(await canAccessEvent({ id: 1, role: 'PROTOCOL' }, 10), true);
    }
  );
});

test('canAccessEvent returns true only when a participation row exists', async () => {
  const calls = [];

  await withMockQuery(
    async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ '?column?': 1 }] };
    },
    async () => {
      assert.equal(await canAccessEvent({ id: 7, role: 'SUPERVISOR' }, 12), true);
    }
  );

  assert.deepEqual(calls[0].params, [12, 7]);

  await withMockQuery(
    async () => ({ rows: [] }),
    async () => {
      assert.equal(await canAccessEvent({ id: 8, role: 'COLLABORATOR' }, 12), false);
    }
  );
});

test('canAccessSection scopes checks by event, section, and user', async () => {
  const calls = [];

  await withMockQuery(
    async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ '?column?': 1 }] };
    },
    async () => {
      assert.equal(await canAccessSection({ id: 4, role: 'COLLABORATOR' }, 9, 22), true);
    }
  );

  assert.deepEqual(calls[0].params, [9, 22, 4]);

  await withMockQuery(
    async () => ({ rows: [] }),
    async () => {
      assert.equal(await canAccessSection({ id: 5, role: 'SUPERVISOR' }, 9, 22), false);
    }
  );
});
