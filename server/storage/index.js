const config = require('../config');

function createStorage() {
  const backend = process.env.STORAGE_BACKEND || 'database';
  if (backend === 'database') {
    return require('./database');
  }
  throw new Error(`Unknown storage backend: ${backend}`);
}

module.exports = createStorage();
