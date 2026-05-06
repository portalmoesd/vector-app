const test = require('node:test');
const assert = require('node:assert/strict');
const logger = require('../logger');

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

function withMockedLogger(fn) {
  const originalInfo = logger.info;
  const calls = [];
  logger.info = (...args) => {
    calls.push(args);
  };
  try {
    fn(calls);
  } finally {
    logger.info = originalInfo;
  }
}

test('request logger skips health and readiness probes', () => {
  const requestLogger = require('./request-logger');
  withMockedLogger((calls) => {
    for (const path of ['/api/health', '/api/ready']) {
      const res = mockResponse();
      requestLogger({ path, method: 'GET', originalUrl: path }, res, () => {});
      res.finish();
    }
    assert.deepEqual(calls, []);
  });
});

test('request logger records non-probe requests with user id', () => {
  const requestLogger = require('./request-logger');
  withMockedLogger((calls) => {
    const res = mockResponse();
    requestLogger(
      {
        path: '/api/events',
        method: 'GET',
        originalUrl: '/api/events',
        user: { id: 7 },
      },
      res,
      () => {}
    );
    res.finish();

    assert.equal(calls.length, 1);
    const logObj = calls[0][0];
    assert.equal(logObj.type, 'http_request');
    assert.equal(logObj.method, 'GET');
    assert.equal(logObj.path, '/api/events');
    assert.equal(logObj.status, 200);
    assert.equal(logObj.userId, 7);
    assert.equal(typeof logObj.durationMs, 'number');
  });
});

test('request logger logs structured fields for POST with status change', () => {
  const requestLogger = require('./request-logger');
  withMockedLogger((calls) => {
    const res = mockResponse();
    requestLogger(
      {
        path: '/api/events',
        method: 'POST',
        originalUrl: '/api/events',
        user: { id: 9 },
      },
      res,
      () => {}
    );
    res.statusCode = 201;
    res.finish();

    assert.equal(calls.length, 1);
    const logObj = calls[0][0];
    assert.deepEqual(Object.keys(logObj).sort(), ['durationMs', 'method', 'path', 'status', 'type', 'userId']);
    assert.equal(logObj.type, 'http_request');
    assert.equal(logObj.method, 'POST');
    assert.equal(logObj.path, '/api/events');
    assert.equal(logObj.status, 201);
    assert.equal(logObj.userId, 9);
  });
});
