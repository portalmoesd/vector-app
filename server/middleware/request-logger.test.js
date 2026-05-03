const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config');
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
  const originalFormat = config.logFormat;
  config.logFormat = 'text';
  try {
    await withMockedConsoleLog(async (lines) => {
      for (const path of ['/api/health', '/api/ready']) {
        const res = mockResponse();
        requestLogger({ path, method: 'GET', originalUrl: path }, res, () => {});
        res.finish();
      }

      assert.deepEqual(lines, []);
    });
  } finally {
    config.logFormat = originalFormat;
  }
});

test('request logger records non-probe requests with user id', async () => {
  const originalFormat = config.logFormat;
  config.logFormat = 'text';
  try {
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
  } finally {
    config.logFormat = originalFormat;
  }
});

test('request logger supports structured JSON output', async () => {
  const originalFormat = config.logFormat;
  config.logFormat = 'json';
  try {
    await withMockedConsoleLog(async (lines) => {
      const res = mockResponse();
      requestLogger({
        path: '/api/events',
        method: 'POST',
        originalUrl: '/api/events',
        user: { id: 9 },
      }, res, () => {});
      res.statusCode = 201;
      res.finish();

      assert.equal(lines.length, 1);
      assert.deepEqual(
        Object.keys(JSON.parse(lines[0])).sort(),
        ['durationMs', 'method', 'path', 'status', 'type', 'userId']
      );
      assert.equal(JSON.parse(lines[0]).type, 'http_request');
      assert.equal(JSON.parse(lines[0]).method, 'POST');
      assert.equal(JSON.parse(lines[0]).path, '/api/events');
      assert.equal(JSON.parse(lines[0]).status, 201);
      assert.equal(JSON.parse(lines[0]).userId, 9);
    });
  } finally {
    config.logFormat = originalFormat;
  }
});
