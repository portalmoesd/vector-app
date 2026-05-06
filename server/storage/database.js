const db = require('../db');

module.exports = {
  async store(fileId, buffer) {
    await db.query('UPDATE section_files SET file_data = $1 WHERE id = $2', [buffer, fileId]);
  },
  async retrieve(fileId) {
    const { rows } = await db.query('SELECT file_data FROM section_files WHERE id = $1', [fileId]);
    return rows[0]?.file_data || null;
  },
  async remove(fileId) {
    await db.query('UPDATE section_files SET file_data = NULL WHERE id = $1', [fileId]);
  },
};
