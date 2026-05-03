const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STATUS,
  baseRole,
  buildChain,
  nextInChain,
  isFinalApprover,
  currentHolderRole,
  submittedToStatus,
  approvedByStatus,
  returnedByStatus,
  firstEditorRole,
  canPushSection,
  canPullSection,
} = require('./pipeline');

test('buildChain creates advanced home and cross-department chains', () => {
  assert.deepEqual(
    buildChain('DEPUTY', false, false, 'advanced'),
    ['COLLABORATOR', 'SUPER_COLLABORATOR', 'SUPERVISOR', 'DEPUTY']
  );

  assert.deepEqual(
    buildChain('DEPUTY', true, true, 'advanced'),
    [
      'COLLABORATOR',
      'SUPER_COLLABORATOR',
      'SUPERVISOR',
      'CURATOR',
      'RECEIVING_SUPER_COLLABORATOR',
      'RECEIVING_SUPERVISOR',
      'DEPUTY',
    ]
  );

  assert.deepEqual(
    buildChain('SUPERVISOR', false, true, 'advanced'),
    [
      'COLLABORATOR',
      'SUPER_COLLABORATOR',
      'SUPERVISOR',
      'RECEIVING_SUPER_COLLABORATOR',
      'RECEIVING_SUPERVISOR',
    ]
  );
});

test('buildChain creates simple workflow chain with optional curator final step', () => {
  assert.deepEqual(
    buildChain('DEPUTY', false, true, 'simple'),
    ['COLLABORATOR', 'SUPER_COLLABORATOR', 'SUPERVISOR']
  );

  assert.deepEqual(
    buildChain('SUPERVISOR', true, false, 'simple'),
    ['COLLABORATOR', 'SUPER_COLLABORATOR', 'SUPERVISOR', 'CURATOR']
  );
});

test('status helpers and role navigation preserve workflow naming', () => {
  const chain = buildChain('DEPUTY', true, true, 'advanced');

  assert.equal(baseRole('RECEIVING_SUPERVISOR'), 'SUPERVISOR');
  assert.equal(baseRole('CURATOR'), 'CURATOR');
  assert.equal(submittedToStatus('RECEIVING_SUPERVISOR'), 'submitted_to_receiving_supervisor');
  assert.equal(approvedByStatus('CURATOR'), 'approved_by_curator');
  assert.equal(returnedByStatus('SUPER_COLLABORATOR'), 'returned_by_super_collaborator');
  assert.equal(nextInChain('CURATOR', chain), 'RECEIVING_SUPER_COLLABORATOR');
  assert.equal(nextInChain('DEPUTY', chain), null);
  assert.equal(isFinalApprover('DEPUTY', chain), true);
  assert.equal(isFinalApprover('CURATOR', chain), false);
  assert.equal(firstEditorRole(chain), 'COLLABORATOR');
});

test('currentHolderRole resolves draft, submitted, returned, and approved states', () => {
  const chain = buildChain('DEPUTY', false, false, 'advanced');

  assert.equal(currentHolderRole(STATUS.DRAFT, null, null, chain), 'COLLABORATOR');
  assert.equal(currentHolderRole(STATUS.DRAFT, 'SUPER_COLLABORATOR', null, chain), 'SUPER_COLLABORATOR');
  assert.equal(currentHolderRole('submitted_to_supervisor', null, null, chain), 'SUPERVISOR');
  assert.equal(currentHolderRole('returned_by_deputy', 'COLLABORATOR', 'SUPER_COLLABORATOR', chain), 'SUPER_COLLABORATOR');
  assert.equal(currentHolderRole('approved_by_super_collaborator', null, null, chain), 'SUPERVISOR');
  assert.equal(currentHolderRole('approved_by_deputy', null, null, chain), null);
});

test('canPushSection handles advanced cross-department push rules', () => {
  const chain = buildChain('DEPUTY', true, true, 'advanced');

  assert.equal(canPushSection('COLLABORATOR', chain, true, 'COLLABORATOR', false, 'advanced'), true);
  assert.equal(canPushSection('SUPERVISOR', chain, true, 'CURATOR', true, 'advanced'), true);
  assert.equal(canPushSection('SUPERVISOR', chain, true, 'CURATOR', false, 'advanced'), false);
  assert.equal(canPushSection('CURATOR', chain, true, 'CURATOR', false, 'advanced'), false);
  assert.equal(canPushSection('COLLABORATOR', chain, false, 'COLLABORATOR', false, 'advanced'), false);
});

test('canPushSection handles simple workflow shortcut rules', () => {
  const chain = buildChain('DEPUTY', false, false, 'simple');

  assert.equal(canPushSection('COLLABORATOR', chain, false, 'SUPER_COLLABORATOR', false, 'simple'), true);
  assert.equal(canPushSection('SUPER_COLLABORATOR', chain, false, 'SUPERVISOR', false, 'simple'), true);
  assert.equal(canPushSection('SUPERVISOR', chain, false, 'SUPERVISOR', false, 'simple'), false);
  assert.equal(canPushSection('DEPUTY', chain, false, 'SUPERVISOR', false, 'simple'), false);
});

test('canPullSection respects chain order and receiving boundary', () => {
  const chain = buildChain('DEPUTY', false, true, 'advanced');

  assert.equal(canPullSection('SUPER_COLLABORATOR', chain, 'COLLABORATOR'), true);
  assert.equal(canPullSection('COLLABORATOR', chain, 'SUPER_COLLABORATOR'), false);
  assert.equal(canPullSection('RECEIVING_SUPER_COLLABORATOR', chain, 'SUPERVISOR'), false);
  assert.equal(canPullSection('RECEIVING_SUPERVISOR', chain, 'RECEIVING_SUPER_COLLABORATOR'), true);
});

test('canPullSection allows simple document submitter amendment override only when valid', () => {
  const chain = buildChain('DEPUTY', false, false, 'simple');
  const opts = { workflowType: 'simple', isDS: true, eventStatus: 'IN_PROGRESS' };

  assert.equal(canPullSection('DEPUTY', chain, 'SUPERVISOR', { ...opts, status: 'submitted_to_supervisor' }), true);
  assert.equal(canPullSection('DEPUTY', chain, 'SUPERVISOR', { ...opts, status: 'approved_by_supervisor' }), true);
  assert.equal(canPullSection('DEPUTY', chain, 'SUPERVISOR', { ...opts, status: 'submitted_to_amending_ds' }), false);
  assert.equal(canPullSection('DEPUTY', chain, 'SUPERVISOR', { ...opts, eventStatus: 'COMPLETED', status: 'approved_by_supervisor' }), false);
});
