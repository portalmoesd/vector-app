const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('./config');
const { resolveAllowDefaultSeedUsers, parsePositiveInt } = config;

test('resolveAllowDefaultSeedUsers allows default seeds only outside production', () => {
  assert.equal(resolveAllowDefaultSeedUsers(false, undefined), true);
  assert.equal(resolveAllowDefaultSeedUsers(false, 'true'), true);
  assert.equal(resolveAllowDefaultSeedUsers(false, 'false'), false);
  assert.equal(resolveAllowDefaultSeedUsers(true, undefined), false);
  assert.equal(resolveAllowDefaultSeedUsers(true, 'true'), false);
});

test('parsePositiveInt falls back for invalid values', () => {
  assert.equal(parsePositiveInt('25', 10), 25);
  assert.equal(parsePositiveInt('0', 10), 10);
  assert.equal(parsePositiveInt('-1', 10), 10);
  assert.equal(parsePositiveInt('not-a-number', 10), 10);
  assert.equal(parsePositiveInt(undefined, 10), 10);
});

test('auth rate limit defaults protect login without extra setup', () => {
  assert.equal(config.authRateLimitWindowMs, 15 * 60 * 1000);
  assert.equal(config.authRateLimitMax, 20);
});
