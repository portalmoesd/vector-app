const db = require('../db');

async function resolveHomeDepartmentId(event) {
  if (event.document_submitter_role === 'DEPUTY' && event.supervisor_id) {
    const {
      rows: [sv],
    } = await db.query('SELECT department_id FROM users WHERE id = $1', [event.supervisor_id]);
    return sv ? sv.department_id : null;
  }
  const {
    rows: [dsUser],
  } = await db.query('SELECT department_id FROM users WHERE id = $1', [event.document_submitter_id]);
  return dsUser ? dsUser.department_id : null;
}

module.exports = { resolveHomeDepartmentId };
