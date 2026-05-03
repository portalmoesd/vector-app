const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimit } = require('./rate-limit');

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
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

async function withMockedNow(values, fn) {
  const originalNow = Date.now;
  let index = 0;
  Date.now = () => values[Math.min(index++, values.length - 1)];
  try {
    await fn();
  } finally {
    Date.now = originalNow;
  }
}

function runMiddleware(middleware, req) {
  const res = mockResponse();
  let nextCalls = 0;
  middleware(req, res, () => {
    nextCalls += 1;
  });
  return { res, nextCalls };
}

test('rate limiter allows requests up to the configured max', async () => {
  await withMockedNow([1000, 1001], async () => {
    const middleware = createRateLimit({ windowMs: 60_000, max: 2, keyPrefix: 'login' });
    const req = { ip: '203.0.113.10' };

    const first = runMiddleware(middleware, req);
    const second = runMiddleware(middleware, req);

    assert.equal(first.nextCalls, 1);
    assert.equal(second.nextCalls, 1);
    assert.equal(second.res.statusCode, 200);
  });
});

test('rate limiter blocks requests over the configured max', async () => {
  await withMockedNow([1000, 1001, 1002], async () => {
    const middleware = createRateLimit({ windowMs: 60_000, max: 2, keyPrefix: 'login' });
    const req = { ip: '203.0.113.10' };

    runMiddleware(middleware, req);
    runMiddleware(middleware, req);
    const blocked = runMiddleware(middleware, req);

    assert.equal(blocked.nextCalls, 0);
    assert.equal(blocked.res.statusCode, 429);
    assert.equal(blocked.res.headers['retry-after'], '60');
    assert.deepEqual(blocked.res.body, { error: 'Too many requests. Please try again later.' });
  });
});

test('rate limiter resets a key after the window expires', async () => {
  await withMockedNow([1000, 2001], async () => {
    const middleware = createRateLimit({ windowMs: 1_000, max: 1, keyPrefix: 'login' });
    const req = { socket: { remoteAddress: '198.51.100.20' } };

    runMiddleware(middleware, req);
    const secondWindow = runMiddleware(middleware, req);

    assert.equal(secondWindow.nextCalls, 1);
    assert.equal(secondWindow.res.statusCode, 200);
  });
});
