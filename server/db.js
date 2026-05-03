const { Pool } = require('pg');
const config = require('./config');

function buildPoolConfig(databaseUrl, sslMode = 'auto', options = {}) {
  const poolConfig = {
    connectionString: databaseUrl,
    max: options.max,
    idleTimeoutMillis: options.idleTimeoutMillis,
    connectionTimeoutMillis: options.connectionTimeoutMillis,
  };
  for (const key of Object.keys(poolConfig)) {
    if (poolConfig[key] === undefined) delete poolConfig[key];
  }
  const mode = String(sslMode || 'auto').toLowerCase();

  if (mode === 'disable') {
    return poolConfig;
  }

  if (mode === 'require') {
    poolConfig.ssl = { rejectUnauthorized: true };
    return poolConfig;
  }

  if (mode === 'no-verify') {
    poolConfig.ssl = { rejectUnauthorized: false };
    return poolConfig;
  }

  // Keep the existing Render behavior for compatibility, while allowing
  // buyer deployments to choose a stricter DATABASE_SSL_MODE explicitly.
  if (databaseUrl && databaseUrl.includes('render.com')) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }

  return poolConfig;
}

const poolConfig = buildPoolConfig(config.databaseUrl, config.databaseSslMode, {
  max: config.databasePoolMax,
  idleTimeoutMillis: config.databaseIdleTimeoutMs,
  connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
});
const pool = new Pool(poolConfig);

module.exports = {
  buildPoolConfig,
  query: (text, params) => pool.query(text, params),
  pool,
  close: () => pool.end(),
};
