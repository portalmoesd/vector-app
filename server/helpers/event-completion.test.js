const test = require('node:test');
const assert = require('node:assert/strict');
const { checkEventCompletion } = require('./event-completion');

function mockDb(responses) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const next = responses.shift();
      if (typeof next === 'function') return next(sql, params);
      return next;
    },
  };
}

test('checkEventCompletion completes simple events when every section is approved', async () => {
  const db = mockDb([
    { rows: [{ workflow_type: 'simple', status: 'IN_PROGRESS' }] },
    { rows: [{ status: 'approved_by_supervisor' }, { status: 'approved_by_curator' }] },
    { rows: [] },
  ]);

  const completed = await checkEventCompletion(db, 42);

  assert.equal(completed, true);
  assert.equal(db.calls.length, 3);
  assert.match(db.calls[2].sql, /UPDATE events/);
  assert.deepEqual(db.calls[2].params, [42]);
});

test('checkEventCompletion leaves advanced events behind the manual library gate', async () => {
  const db = mockDb([
    { rows: [{ workflow_type: 'advanced', status: 'IN_PROGRESS' }] },
  ]);

  const completed = await checkEventCompletion(db, 42);

  assert.equal(completed, false);
  assert.equal(db.calls.length, 1);
});

test('checkEventCompletion waits until all simple sections are approved', async () => {
  const db = mockDb([
    { rows: [{ workflow_type: 'simple', status: 'IN_PROGRESS' }] },
    { rows: [{ status: 'approved_by_supervisor' }, { status: 'submitted_to_curator' }] },
  ]);

  const completed = await checkEventCompletion(db, 42);

  assert.equal(completed, false);
  assert.equal(db.calls.length, 2);
});

test('checkEventCompletion ignores missing, empty, and already completed events', async () => {
  const missingDb = mockDb([{ rows: [] }]);
  assert.equal(await checkEventCompletion(missingDb, 1), false);
  assert.equal(missingDb.calls.length, 1);

  const emptyDb = mockDb([
    { rows: [{ workflow_type: 'simple', status: 'IN_PROGRESS' }] },
    { rows: [] },
  ]);
  assert.equal(await checkEventCompletion(emptyDb, 2), false);
  assert.equal(emptyDb.calls.length, 2);

  const completedDb = mockDb([
    { rows: [{ workflow_type: 'simple', status: 'COMPLETED' }] },
  ]);
  assert.equal(await checkEventCompletion(completedDb, 3), false);
  assert.equal(completedDb.calls.length, 1);
});
