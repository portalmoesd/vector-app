const { Pool } = require('pg');
const config = require('./config');

const poolConfig = { connectionString: config.databaseUrl };

// Render requires SSL for external connections
if (config.databaseUrl && config.databaseUrl.includes('render.com')) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
