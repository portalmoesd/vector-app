const test = require('node:test');
const assert = require('node:assert/strict');
const {
  asTrimmedString,
  asPositiveInt,
  asPositiveIntArray,
  asEnum,
  asBoolean,
  asIsoDate,
  asEmail,
  asUsername,
} = require('./validation');

test('asTrimmedString trims and enforces required/max rules', () => {
  assert.deepEqual(asTrimmedString('  Event  ', 'title', { required: true }), { value: 'Event' });
  assert.equal(asTrimmedString('   ', 'title', { required: true }).error, 'title is required');
  assert.equal(asTrimmedString('abcd', 'title', { max: 3 }).error, 'title must be 3 characters or fewer');
});

test('asPositiveInt parses only positive integers', () => {
  assert.deepEqual(asPositiveInt('12', 'id'), { value: 12 });
  assert.equal(asPositiveInt('0', 'id').error, 'id must be a positive integer');
  assert.equal(asPositiveInt('1.5', 'id').error, 'id must be a positive integer');
});

test('asPositiveIntArray deduplicates positive integer arrays', () => {
  assert.deepEqual(asPositiveIntArray(['1', 2, 2], 'departmentIds'), { value: [1, 2] });
  assert.equal(asPositiveIntArray('1', 'departmentIds').error, 'departmentIds must be an array');
});

test('asEnum and asBoolean normalize known values', () => {
  assert.deepEqual(asEnum('EN', 'language', ['EN', 'KA']), { value: 'EN' });
  assert.equal(asEnum('FR', 'language', ['EN', 'KA']).error, 'language must be one of: EN, KA');
  assert.deepEqual(asBoolean('yes', 'curatorRequired'), { value: true });
  assert.deepEqual(asBoolean(undefined, 'curatorRequired'), { value: false });
});

test('asIsoDate accepts only real yyyy-mm-dd dates', () => {
  assert.deepEqual(asIsoDate('2026-05-03', 'deadlineDate'), { value: '2026-05-03' });
  assert.equal(asIsoDate('03/05/2026', 'deadlineDate').error, 'deadlineDate must use YYYY-MM-DD format');
  assert.equal(asIsoDate('2026-02-31', 'deadlineDate').error, 'deadlineDate must be a valid date');
});

test('asEmail and asUsername normalize account identifiers', () => {
  assert.deepEqual(asEmail(' USER@Example.COM ', 'email', { required: true }), { value: 'user@example.com' });
  assert.equal(asEmail('not-email', 'email', { required: true }).error, 'email must be a valid email address');
  assert.deepEqual(asUsername(' John.Doe ', 'username', { required: true }), { value: 'john.doe' });
  assert.equal(
    asUsername('ab', 'username', { required: true }).error,
    'username must be 3-100 characters using letters, numbers, dots, underscores, or hyphens'
  );
});
