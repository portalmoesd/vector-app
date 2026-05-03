const test = require('node:test');
const assert = require('node:assert/strict');
const jsonErrorHandler = require('./json-error');

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

test('jsonErrorHandler returns 400 for malformed JSON bodies', () => {
  const res = mockResponse();
  let nextCalled = false;

  jsonErrorHandler({ type: 'entity.parse.failed' }, {}, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Invalid JSON request body' });
});

test('jsonErrorHandler returns 413 for oversized JSON bodies', () => {
  const res = mockResponse();
  let nextCalled = false;

  jsonErrorHandler({ type: 'entity.too.large' }, {}, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 413);
  assert.deepEqual(res.body, { error: 'JSON request body must be 10MB or smaller' });
});

test('jsonErrorHandler passes unrelated errors to the final handler', () => {
  const res = mockResponse();
  const err = new Error('other');
  let received;

  jsonErrorHandler(err, {}, res, (nextErr) => {
    received = nextErr;
  });

  assert.equal(received, err);
  assert.equal(res.statusCode, 200);
});
