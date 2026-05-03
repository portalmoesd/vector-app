const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveAllowDefaultSeedUsers } = require('./config');

test('resolveAllowDefaultSeedUsers allows default seeds only outside production', () => {
  assert.equal(resolveAllowDefaultSeedUsers(false, undefined), true);
  assert.equal(resolveAllowDefaultSeedUsers(false, 'true'), true);
  assert.equal(resolveAllowDefaultSeedUsers(false, 'false'), false);
  assert.equal(resolveAllowDefaultSeedUsers(true, undefined), false);
  assert.equal(resolveAllowDefaultSeedUsers(true, 'true'), false);
});
