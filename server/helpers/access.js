const db = require('../db');
const { ROLES } = require('./roles');

function isAdminLike(role) {
  return role === ROLES.ADMIN || role === ROLES.PROTOCOL;
}

async function canAccessEvent(user, eventId) {
  if (!user || !eventId) return false;
  if (isAdminLike(user.role)) return true;

  const { rows } = await db.query(
    `SELECT 1
     FROM events e
     WHERE e.id = $1
       AND (
         e.document_submitter_id = $2
         OR e.deputy_id = $2
         OR e.supervisor_id = $2
         OR e.created_by_id = $2
         OR e.country_id IN (SELECT country_id FROM country_assignments WHERE user_id = $2)
         OR EXISTS (
           SELECT 1
           FROM sections s
           JOIN section_departments sd ON sd.section_id = s.id
           JOIN users u ON u.id = $2
           WHERE s.event_id = e.id AND sd.department_id = u.department_id
         )
         OR EXISTS (
           SELECT 1
           FROM sections s
           JOIN section_departments sd ON sd.section_id = s.id
           JOIN deputy_department_links ddl ON ddl.department_id = sd.department_id
           WHERE s.event_id = e.id AND ddl.deputy_id = $2
         )
         OR EXISTS (
           SELECT 1 FROM section_history sh WHERE sh.event_id = e.id AND sh.user_id = $2
         )
       )
     LIMIT 1`,
    [eventId, user.id]
  );
  return rows.length > 0;
}

async function canAccessSection(user, eventId, sectionId) {
  if (!user || !eventId || !sectionId) return false;
  if (isAdminLike(user.role)) return true;

  const { rows } = await db.query(
    `SELECT 1
     FROM events e
     JOIN sections s ON s.event_id = e.id
     WHERE e.id = $1
       AND s.id = $2
       AND (
         e.document_submitter_id = $3
         OR e.deputy_id = $3
         OR e.supervisor_id = $3
         OR e.created_by_id = $3
         OR e.country_id IN (SELECT country_id FROM country_assignments WHERE user_id = $3)
         OR EXISTS (
           SELECT 1
           FROM section_departments sd
           JOIN users u ON u.id = $3
           WHERE sd.section_id = s.id AND sd.department_id = u.department_id
         )
         OR EXISTS (
           SELECT 1
           FROM section_departments sd
           JOIN deputy_department_links ddl ON ddl.department_id = sd.department_id
           WHERE sd.section_id = s.id AND ddl.deputy_id = $3
         )
         OR EXISTS (
           SELECT 1
           FROM section_history sh
           WHERE sh.event_id = e.id AND sh.section_id = s.id AND sh.user_id = $3
         )
       )
     LIMIT 1`,
    [eventId, sectionId, user.id]
  );
  return rows.length > 0;
}

module.exports = { canAccessEvent, canAccessSection };
