const test = require('node:test');
const assert = require('node:assert/strict');
const requestLogger = require('./request-logger');

function mockResponse() {
  const listeners = {};
  return {
    statusCode: 200,
    on(event, handler) {
      listeners[event] = handler;
    },
    finish() {
      listeners.finish();
    },
  };
}

async function withMockedConsoleLog(fn) {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => {
    lines.push(args.join(' '));
  };
  try {
    await fn(lines);
  } finally {
    console.log = originalLog;
  }
}

test('request logger skips health and readiness probes', async () => {
  await withMockedConsoleLog(async (lines) => {
    for (const path of ['/api/health', '/api/ready']) {
      const res = mockResponse();
      requestLogger({ path, method: 'GET', originalUrl: path }, res, () => {});
      res.finish();
    }

    assert.deepEqual(lines, []);
  });
});

test('request logger records non-probe requests with user id', async () => {
  await withMockedConsoleLog(async (lines) => {
    const res = mockResponse();
    requestLogger({
      path: '/api/events',
      method: 'GET',
      originalUrl: '/api/events',
      user: { id: 7 },
    }, res, () => {});
    res.finish();

    assert.equal(lines.length, 1);
    assert.match(lines[0], /^GET \/api\/events 200 \d+\.\dms user=7$/);
  });
});
