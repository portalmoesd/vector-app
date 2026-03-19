const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/sections?event_id=X
router.get('/', requireAuth, async (req, res) => {
  try {
    const eventId = req.query.event_id;
    if (!eventId) return res.status(400).json({ error: 'event_id is required' });

    const { rows } = await db.query(
      `SELECT s.id, s.title, s.sort_order,
              array_agg(sd.department_id) AS department_ids
       FROM sections s
       LEFT JOIN section_departments sd ON sd.section_id = s.id
       WHERE s.event_id = $1
       GROUP BY s.id
       ORDER BY s.sort_order`,
      [eventId]
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
router.patch('/:id/label', requireAuth, async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    await db.query(
      'UPDATE sections SET title = $1, updated_at = now() WHERE id = $2',
      [title, req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Rename section error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
