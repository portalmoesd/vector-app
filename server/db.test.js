const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPoolConfig } = require('./db');

test('buildPoolConfig leaves SSL disabled by default for ordinary database URLs', () => {
  assert.deepEqual(
    buildPoolConfig('postgres://user:pass@localhost:5432/vector', 'auto'),
    { connectionString: 'postgres://user:pass@localhost:5432/vector' }
  );
});

test('buildPoolConfig preserves Render auto SSL compatibility', () => {
  assert.deepEqual(
    buildPoolConfig('postgres://user:pass@oregon-postgres.render.com/vector', 'auto'),
    {
      connectionString: 'postgres://user:pass@oregon-postgres.render.com/vector',
      ssl: { rejectUnauthorized: false },
    }
  );
});

test('buildPoolConfig supports explicit buyer SSL modes', () => {
  assert.deepEqual(
    buildPoolConfig('postgres://user:pass@db.example/vector', 'require'),
    {
      connectionString: 'postgres://user:pass@db.example/vector',
      ssl: { rejectUnauthorized: true },
    }
  );
  assert.deepEqual(
    buildPoolConfig('postgres://user:pass@db.example/vector', 'no-verify'),
    {
      connectionString: 'postgres://user:pass@db.example/vector',
      ssl: { rejectUnauthorized: false },
    }
  );
  assert.deepEqual(
    buildPoolConfig('postgres://user:pass@db.example/vector', 'disable'),
    { connectionString: 'postgres://user:pass@db.example/vector' }
  );
});
