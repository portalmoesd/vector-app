const test = require('node:test');
const assert = require('node:assert/strict');
const corsErrorHandler = require('./cors-error');

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

test('corsErrorHandler returns 403 for denied origins', () => {
  const res = mockResponse();
  let nextCalled = false;

  corsErrorHandler({ code: 'CORS_ORIGIN_DENIED' }, {}, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Origin not allowed by CORS' });
});

test('corsErrorHandler passes unrelated errors through', () => {
  const res = mockResponse();
  const err = new Error('other');
  let received;

  corsErrorHandler(err, {}, res, (nextErr) => {
    received = nextErr;
  });

  assert.equal(received, err);
  assert.equal(res.statusCode, 200);
});
