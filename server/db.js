const { Pool } = require('pg');
const config = require('./config');

function buildPoolConfig(databaseUrl, sslMode = 'auto') {
  const poolConfig = { connectionString: databaseUrl };
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

const poolConfig = buildPoolConfig(config.databaseUrl, config.databaseSslMode);
const pool = new Pool(poolConfig);

module.exports = {
  buildPoolConfig,
  query: (text, params) => pool.query(text, params),
  pool,
  close: () => pool.end(),
};
