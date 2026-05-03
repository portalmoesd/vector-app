const express = require('express');
const db = require('../db');
const { requireAuth, denyAnalyst } = require('../middleware/auth');
const { canCreateEvent, canEndEvent, ROLES } = require('../helpers/roles');
const { canAccessEvent } = require('../helpers/access');
const { resolveEventNotificationDraft } = require('../helpers/event-notification-draft');
const {
  asTrimmedString,
  asOptionalTrimmedString,
  asPositiveInt,
  asPositiveIntArray,
  asEnum,
  asBoolean,
  asIsoDate,
  validationError,
} = require('../helpers/validation');

const router = express.Router();
const DS_ROLES = ['DEPUTY', 'SUPERVISOR', 'SUPER_COLLABORATOR'];
const LANGUAGES = ['EN', 'FR', 'AR', 'ES', 'RU', 'ZH', 'PT', 'DE', 'KA'];
const WORKFLOW_TYPES = ['advanced', 'simple'];

function parseEventSections(rawSections) {
  if (!Array.isArray(rawSections) || rawSections.length === 0) {
    return { error: 'sections must include at least one section' };
  }
  if (rawSections.length > 100) {
    return { error: 'sections must include 100 sections or fewer' };
  }

  const sections = [];
  for (const rawSection of rawSections) {
    const title = asTrimmedString(rawSection && rawSection.title, 'section title', { required: true, max: 500 });
    if (title.error) return title;
    const departmentIds = asPositiveIntArray(rawSection ? rawSection.departmentIds : undefined, 'departmentIds');
    if (departmentIds.error) return departmentIds;
    sections.push({ title: title.value, departmentIds: departmentIds.value });
  }
  return { value: sections };
}

async function requireEventAccess(req, res, eventId) {
  const parsedEventId = asPositiveInt(eventId, 'eventId');
  if (parsedEventId.error) {
    res.status(400).json({ error: parsedEventId.error });
    return false;
  }

  const { rows: [event] } = await db.query('SELECT id FROM events WHERE id = $1', [parsedEventId.value]);
  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return false;
  }
  if (!(await canAccessEvent(req.user, parsedEventId.value))) {
    res.status(403).json({ error: 'Not authorized to access this event' });
    return false;
  }
  return parsedEventId.value;
}

// GET /api/events — list events visible to current user
router.get('/', requireAuth, async (req, res) => {
  try {
    const role = req.user.role;
    const userId = req.user.id;
    const isAdmin = role === ROLES.ADMIN || role === ROLES.PROTOCOL;
    const isCollabRole = role === ROLES.COLLABORATOR || role === ROLES.SUPER_COLLABORATOR;

    let whereClause = '';
    let params = [];

    if (isAdmin) {
      // ADMIN and PROTOCOL see all events
    } else if (isCollabRole) {
      // SC/Collaborator: must match BOTH country assignment AND section department
      whereClause = `WHERE (
        (
          e.country_id IN (SELECT country_id FROM country_assignments WHERE user_id = $1)
          AND EXISTS (
            SELECT 1 FROM sections s
            JOIN section_departments sd ON sd.section_id = s.id
            WHERE s.event_id = e.id
              AND sd.department_id = (SELECT department_id FROM users WHERE id = $1)
          )
        )
        OR e.document_submitter_id = $1
        OR e.deputy_id = $1
        OR e.supervisor_id = $1
        OR e.created_by_id = $1
      )`;
      params = [userId];
    } else {
      // Supervisor / Deputy: country assignment OR direct assignment OR
      // their department has any section in the event OR (for deputies)
      // they oversee any of the section departments via
      // deputy_department_links (which is what makes them the curator).
      // Without this, a supervisor / deputy without a country_assignment
      // never sees the event even though their department is on it.
      whereClause = `WHERE (
        e.country_id IN (SELECT country_id FROM country_assignments WHERE user_id = $1)
        OR e.document_submitter_id = $1
        OR e.deputy_id = $1
        OR e.supervisor_id = $1
        OR e.created_by_id = $1
        OR EXISTS (
          SELECT 1 FROM sections s
          JOIN section_departments sd ON sd.section_id = s.id
          WHERE s.event_id = e.id
            AND sd.department_id = (SELECT department_id FROM users WHERE id = $1)
        )
        OR EXISTS (
          SELECT 1 FROM sections s
          JOIN section_departments sd ON sd.section_id = s.id
          JOIN deputy_department_links ddl ON ddl.department_id = sd.department_id
          WHERE s.event_id = e.id AND ddl.deputy_id = $1
        )
      )`;
      params = [userId];
    }

    const { rows } = await db.query(
      `SELECT e.id, e.title, e.country_id, e.document_submitter_role,
              e.document_submitter_id, e.deputy_id, e.supervisor_id, e.curator_required,
              e.workflow_type,
              e.language, e.deadline_date, e.occasion, e.is_active,
              e.ended_at, e.status, e.created_at,
              c.name_en AS country_name, c.code AS country_code,
              ds.full_name AS document_submitter_name,
              sv.full_name AS supervisor_name
       FROM events e
       JOIN countries c ON c.id = e.country_id
       JOIN users ds ON ds.id = e.document_submitter_id
       LEFT JOIN users sv ON sv.id = e.supervisor_id
       ${whereClause}
       ORDER BY e.created_at DESC`,
      params
    );
    res.json(rows.map(r => ({
      id: r.id,
      title: r.title,
      countryId: r.country_id,
      countryName: r.country_name,
      countryCode: r.country_code,
      documentSubmitterRole: r.document_submitter_role,
      documentSubmitterId: r.document_submitter_id,
      documentSubmitterName: r.document_submitter_name,
      deputyId: r.deputy_id,
      supervisorId: r.supervisor_id,
      supervisorName: r.supervisor_name,
      curatorRequired: r.curator_required,
      workflowType: r.workflow_type,
      language: r.language,
      deadlineDate: r.deadline_date,
      occasion: r.occasion,
      isActive: r.is_active,
      endedAt: r.ended_at,
      status: r.status,
      createdAt: r.created_at,
    })));
  } catch (err) {
    console.error('List events error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/events — create event
router.post('/', requireAuth, denyAnalyst, async (req, res) => {
  try {
    if (!canCreateEvent(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized to create events' });
    }

    const title = asTrimmedString(req.body.title, 'title', { required: true, max: 500 });
    if (title.error) return validationError(res, title.error);
    const countryId = asPositiveInt(req.body.countryId, 'countryId');
    if (countryId.error) return validationError(res, countryId.error);
    const documentSubmitterRole = asEnum(req.body.documentSubmitterRole, 'documentSubmitterRole', DS_ROLES);
    if (documentSubmitterRole.error) return validationError(res, documentSubmitterRole.error);
    const documentSubmitterId = asPositiveInt(req.body.documentSubmitterId, 'documentSubmitterId');
    if (documentSubmitterId.error) return validationError(res, documentSubmitterId.error);
    const deputyId = asPositiveInt(req.body.deputyId, 'deputyId', { required: false });
    if (deputyId.error) return validationError(res, deputyId.error);
    const supervisorId = asPositiveInt(req.body.supervisorId, 'supervisorId', { required: false });
    if (supervisorId.error) return validationError(res, supervisorId.error);
    const curatorRequired = asBoolean(req.body.curatorRequired, 'curatorRequired');
    if (curatorRequired.error) return validationError(res, curatorRequired.error);
    const language = asEnum(req.body.language, 'language', LANGUAGES, { default: 'EN' });
    if (language.error) return validationError(res, language.error);
    const deadlineDate = asIsoDate(req.body.deadlineDate, 'deadlineDate');
    if (deadlineDate.error) return validationError(res, deadlineDate.error);
    const occasion = asOptionalTrimmedString(req.body.occasion, 'occasion');
    if (occasion.error) return validationError(res, occasion.error);
    const workflowTypeResult = asEnum(req.body.workflowType, 'workflowType', WORKFLOW_TYPES, { default: 'advanced' });
    if (workflowTypeResult.error) return validationError(res, workflowTypeResult.error);
    const parsedSections = parseEventSections(req.body.sections);
    if (parsedSections.error) return validationError(res, parsedSections.error);

    // Normalise workflow type. Default 'advanced' preserves the existing
    // role-chain behaviour for clients that don't send the field. In
    // 'simple' mode the responsible-supervisor concept doesn't apply
    // (no Department A vs B), so supervisorId is forced to null. The
    // curator flag, however, is opt-in for both modes — when set in
    // simple mode the chain gets a CURATOR step at the end.
    const workflowType = workflowTypeResult.value;
    const effectiveCuratorRequired = curatorRequired.value;
    const effectiveSupervisorId = workflowType === 'simple' ? null : supervisorId.value;

    const { rows: [documentSubmitter] } = await db.query(
      'SELECT id, role FROM users WHERE id = $1',
      [documentSubmitterId.value]
    );
    if (!documentSubmitter || documentSubmitter.role !== documentSubmitterRole.value) {
      return res.status(422).json({ error: 'Document submitter does not match the selected role' });
    }

    if (deputyId.value) {
      const { rows: [deputy] } = await db.query(
        "SELECT id FROM users WHERE id = $1 AND role = 'DEPUTY'",
        [deputyId.value]
      );
      if (!deputy) return res.status(422).json({ error: 'Invalid deputy user' });
    }

    if (workflowType === 'advanced' && documentSubmitterRole.value === 'DEPUTY' && !effectiveSupervisorId) {
      return validationError(res, 'supervisorId is required for advanced deputy workflows');
    }

    if (effectiveSupervisorId) {
      const { rows: [supervisor] } = await db.query(
        "SELECT id FROM users WHERE id = $1 AND role = 'SUPERVISOR'",
        [effectiveSupervisorId]
      );
      if (!supervisor) return res.status(422).json({ error: 'Invalid responsible supervisor user' });
    }

    // ── Role-based DS assignment validation ──────────────────────────────
    const creatorRole = req.user.role;
    if (creatorRole !== ROLES.ADMIN && creatorRole !== ROLES.PROTOCOL) {
      let allowed = false;

      if (creatorRole === ROLES.DEPUTY) {
        if (documentSubmitterRole.value === 'DEPUTY') {
          allowed = documentSubmitterId.value === req.user.id;
        } else if (documentSubmitterRole.value === 'SUPERVISOR') {
          const { rows } = await db.query(
            `SELECT 1 FROM deputy_supervisor_links WHERE deputy_id = $1 AND supervisor_id = $2`,
            [req.user.id, documentSubmitterId.value]
          );
          allowed = rows.length > 0;
        } else if (documentSubmitterRole.value === 'SUPER_COLLABORATOR') {
          const { rows } = await db.query(
            `SELECT 1 FROM users WHERE id = $1 AND role = 'SUPER_COLLABORATOR'
               AND department_id IN (
                 SELECT s.department_id FROM deputy_supervisor_links dsl
                 JOIN users s ON s.id = dsl.supervisor_id
                 WHERE dsl.deputy_id = $2 AND s.department_id IS NOT NULL
               )`,
            [documentSubmitterId.value, req.user.id]
          );
          allowed = rows.length > 0;
        }
      } else if (creatorRole === ROLES.SUPERVISOR) {
        if (documentSubmitterRole.value === 'SUPERVISOR') {
          allowed = documentSubmitterId.value === req.user.id;
        } else if (documentSubmitterRole.value === 'DEPUTY') {
          const { rows } = await db.query(
            `SELECT 1 FROM deputy_supervisor_links WHERE supervisor_id = $1 AND deputy_id = $2`,
            [req.user.id, documentSubmitterId.value]
          );
          allowed = rows.length > 0;
        } else if (documentSubmitterRole.value === 'SUPER_COLLABORATOR') {
          const { rows } = await db.query(
            `SELECT 1 FROM users WHERE id = $1 AND role = 'SUPER_COLLABORATOR' AND department_id = $2`,
            [documentSubmitterId.value, req.user.departmentId]
          );
          allowed = rows.length > 0;
        }
      } else if (creatorRole === ROLES.SUPER_COLLABORATOR) {
        if (documentSubmitterRole.value === 'SUPER_COLLABORATOR') {
          allowed = documentSubmitterId.value === req.user.id;
        } else if (documentSubmitterRole.value === 'SUPERVISOR') {
          const { rows } = await db.query(
            `SELECT 1 FROM users WHERE id = $1 AND role = 'SUPERVISOR' AND department_id = $2`,
            [documentSubmitterId.value, req.user.departmentId]
          );
          allowed = rows.length > 0;
        } else if (documentSubmitterRole.value === 'DEPUTY') {
          const { rows } = await db.query(
            `SELECT 1 FROM deputy_supervisor_links dsl
             JOIN users s ON s.id = dsl.supervisor_id
             WHERE dsl.deputy_id = $1 AND s.department_id = $2`,
            [documentSubmitterId.value, req.user.departmentId]
          );
          allowed = rows.length > 0;
        }
      }

      if (!allowed) {
        return res.status(403).json({ error: 'You are not authorized to assign this document submitter' });
      }
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: [event] } = await client.query(
        `INSERT INTO events (title, country_id, document_submitter_role, document_submitter_id,
                             deputy_id, supervisor_id, curator_required, workflow_type, language,
                             deadline_date, occasion, created_by_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [title.value, countryId.value, documentSubmitterRole.value, documentSubmitterId.value,
         deputyId.value, effectiveSupervisorId, effectiveCuratorRequired, workflowType,
         language.value, deadlineDate.value, occasion.value, req.user.id]
      );

      if (parsedSections.value.length > 0) {
        for (let i = 0; i < parsedSections.value.length; i++) {
          const sec = parsedSections.value[i];
          const { rows: [section] } = await client.query(
            'INSERT INTO sections (event_id, title, sort_order) VALUES ($1, $2, $3) RETURNING id',
            [event.id, sec.title, i]
          );

          if (sec.departmentIds && sec.departmentIds.length > 0) {
            for (const deptId of sec.departmentIds) {
              await client.query(
                'INSERT INTO section_departments (section_id, department_id) VALUES ($1, $2)',
                [section.id, deptId]
              );
            }
          }

          // Create section_content row
          await client.query(
            'INSERT INTO section_content (event_id, section_id) VALUES ($1, $2)',
            [event.id, section.id]
          );
        }
      }

      await client.query('COMMIT');
      res.status(201).json({ id: event.id, success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Create event error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/events/:id/notification-draft — recipients and mail content
router.get('/:id/notification-draft', requireAuth, denyAnalyst, async (req, res) => {
  try {
    const eventId = asPositiveInt(req.params.id, 'eventId');
    if (eventId.error) return validationError(res, eventId.error);
    const allowed = await canAccessEvent(req.user, eventId.value);
    if (!allowed) return res.status(403).json({ error: 'Not authorized to access this event' });

    const draft = await resolveEventNotificationDraft(db, eventId.value);
    if (!draft) return res.status(404).json({ error: 'Event not found' });

    res.json(draft);
  } catch (err) {
    console.error('Notification draft error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/events/:id — event detail with sections
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const eventId = await requireEventAccess(req, res, req.params.id);
    if (!eventId) return;

    const { rows: [event] } = await db.query(
      `SELECT e.id, e.title, e.description, e.country_id, e.document_submitter_role,
              e.document_submitter_id, e.deputy_id, e.supervisor_id, e.curator_required,
              e.workflow_type,
              e.language, e.deadline_date, e.occasion, e.is_active,
              e.ended_at, e.status, e.created_at,
              c.name_en AS country_name, c.code AS country_code,
              ds.full_name AS document_submitter_name,
              dep.full_name AS deputy_name,
              sv.full_name AS supervisor_name
       FROM events e
       JOIN countries c ON c.id = e.country_id
       JOIN users ds ON ds.id = e.document_submitter_id
       LEFT JOIN users dep ON dep.id = e.deputy_id
       LEFT JOIN users sv ON sv.id = e.supervisor_id
       WHERE e.id = $1`,
      [eventId]
    );
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const { rows: sections } = await db.query(
      `SELECT s.id, s.title, s.sort_order,
              array_agg(sd.department_id) AS department_ids
       FROM sections s
       LEFT JOIN section_departments sd ON sd.section_id = s.id
       WHERE s.event_id = $1
       GROUP BY s.id
       ORDER BY s.sort_order`,
      [eventId]
    );

    res.json({
      id: event.id,
      title: event.title,
      description: event.description,
      countryId: event.country_id,
      countryName: event.country_name,
      countryCode: event.country_code,
      documentSubmitterRole: event.document_submitter_role,
      documentSubmitterId: event.document_submitter_id,
      documentSubmitterName: event.document_submitter_name,
      deputyId: event.deputy_id,
      deputyName: event.deputy_name,
      supervisorId: event.supervisor_id,
      supervisorName: event.supervisor_name,
      curatorRequired: event.curator_required,
      workflowType: event.workflow_type,
      language: event.language,
      deadlineDate: event.deadline_date,
      occasion: event.occasion,
      isActive: event.is_active,
      endedAt: event.ended_at,
      status: event.status,
      createdAt: event.created_at,
      sections: sections.map(s => ({
        id: s.id,
        title: s.title,
        sortOrder: s.sort_order,
        departmentIds: (s.department_ids || []).filter(Boolean),
      })),
    });
  } catch (err) {
    console.error('Get event error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/events/:id — edit event
router.patch('/:id', requireAuth, denyAnalyst, async (req, res) => {
  try {
    if (!canCreateEvent(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized to edit events' });
    }
    const eventId = await requireEventAccess(req, res, req.params.id);
    if (!eventId) return;

    const sets = [];
    const params = [];
    let idx = 1;

    if (req.body.title !== undefined) {
      const title = asTrimmedString(req.body.title, 'title', { required: true, max: 500 });
      if (title.error) return validationError(res, title.error);
      sets.push(`title = $${idx++}`); params.push(title.value);
    }
    if (req.body.language !== undefined) {
      const language = asEnum(req.body.language, 'language', LANGUAGES);
      if (language.error) return validationError(res, language.error);
      sets.push(`language = $${idx++}`); params.push(language.value);
    }
    if (req.body.deadlineDate !== undefined) {
      const deadlineDate = asIsoDate(req.body.deadlineDate, 'deadlineDate');
      if (deadlineDate.error) return validationError(res, deadlineDate.error);
      sets.push(`deadline_date = $${idx++}`); params.push(deadlineDate.value);
    }
    if (req.body.occasion !== undefined) {
      const occasion = asOptionalTrimmedString(req.body.occasion, 'occasion');
      if (occasion.error) return validationError(res, occasion.error);
      sets.push(`occasion = $${idx++}`); params.push(occasion.value);
    }

    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });

    sets.push(`updated_at = now()`);
    params.push(eventId);

    const result = await db.query(
      `UPDATE events SET ${sets.join(', ')} WHERE id = $${idx}`,
      params
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Event not found' });

    res.json({ success: true });
  } catch (err) {
    console.error('Edit event error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/events/:id/sections — add section to existing event
router.post('/:id/sections', requireAuth, denyAnalyst, async (req, res) => {
  try {
    if (!canCreateEvent(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const title = asTrimmedString(req.body.title, 'title', { required: true, max: 500 });
    if (title.error) return validationError(res, title.error);
    const departmentIds = asPositiveIntArray(req.body.departmentIds, 'departmentIds');
    if (departmentIds.error) return validationError(res, departmentIds.error);

    const eventId = await requireEventAccess(req, res, req.params.id);
    if (!eventId) return;

    // Get max sort order
    const { rows: [maxRow] } = await db.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM sections WHERE event_id = $1',
      [eventId]
    );

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: [section] } = await client.query(
        'INSERT INTO sections (event_id, title, sort_order) VALUES ($1, $2, $3) RETURNING id',
        [eventId, title.value, maxRow.next_order]
      );

      if (departmentIds.value.length > 0) {
        for (const deptId of departmentIds.value) {
          await client.query(
            'INSERT INTO section_departments (section_id, department_id) VALUES ($1, $2)',
            [section.id, deptId]
          );
        }
      }

      await client.query(
        'INSERT INTO section_content (event_id, section_id) VALUES ($1, $2)',
        [eventId, section.id]
      );

      await client.query('COMMIT');
      res.status(201).json({ id: section.id, success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Add section error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/events/:id/end — end an event
router.post('/:id/end', requireAuth, denyAnalyst, async (req, res) => {
  try {
    if (!canEndEvent(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized to end events' });
    }
    const eventId = await requireEventAccess(req, res, req.params.id);
    if (!eventId) return;

    const result = await db.query(
      `UPDATE events SET is_active = false, ended_at = now(), status = 'ARCHIVED', updated_at = now()
       WHERE id = $1`,
      [eventId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Event not found' });

    res.json({ success: true });
  } catch (err) {
    console.error('End event error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
