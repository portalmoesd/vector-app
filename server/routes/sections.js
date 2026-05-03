const express = require('express');
const db = require('../db');
const { requireAuth, denyAnalyst } = require('../middleware/auth');
const { canCreateEvent } = require('../helpers/roles');
const { canAccessEvent, canAccessSection } = require('../helpers/access');
const { asPositiveInt, asTrimmedString, validationError } = require('../helpers/validation');

const router = express.Router();

// GET /api/sections?event_id=X
router.get('/', requireAuth, async (req, res) => {
  try {
    const eventId = asPositiveInt(req.query.event_id, 'event_id');
    if (eventId.error) return validationError(res, eventId.error);
    if (!(await canAccessEvent(req.user, eventId.value))) {
      return res.status(403).json({ error: 'Not authorized to access this event' });
    }

    const { rows } = await db.query(
      `SELECT s.id, s.title, s.sort_order,
              array_agg(sd.department_id) AS department_ids
       FROM sections s
       LEFT JOIN section_departments sd ON sd.section_id = s.id
      WHERE s.event_id = $1
      GROUP BY s.id
      ORDER BY s.sort_order`,
      [eventId.value]
    );

    res.json(rows.map(r => ({
      id: r.id,
      title: r.title,
      sortOrder: r.sort_order,
      departmentIds: (r.department_ids || []).filter(Boolean),
    })));
  } catch (err) {
    console.error('List sections error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/sections/:id/label — rename section
router.patch('/:id/label', requireAuth, denyAnalyst, async (req, res) => {
  try {
    const sectionId = asPositiveInt(req.params.id, 'id');
    if (sectionId.error) return validationError(res, sectionId.error);
    const title = asTrimmedString(req.body.title, 'title', { required: true, max: 300 });
    if (title.error) return validationError(res, title.error);
    if (!canCreateEvent(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized to rename sections' });
    }

    const { rows: [section] } = await db.query(
      'SELECT event_id FROM sections WHERE id = $1',
      [sectionId.value]
    );
    if (!section) return res.status(404).json({ error: 'Section not found' });
    if (!(await canAccessSection(req.user, section.event_id, sectionId.value))) {
      return res.status(403).json({ error: 'Not authorized to access this section' });
    }

    await db.query(
      'UPDATE sections SET title = $1, updated_at = now() WHERE id = $2',
      [title.value, sectionId.value]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Rename section error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
