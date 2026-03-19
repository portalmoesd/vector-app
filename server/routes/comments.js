const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/workflow/comments?event_id=X&section_id=Y
router.get('/', requireAuth, async (req, res) => {
  try {
    const { event_id, section_id } = req.query;
    const { rows } = await db.query(
      `SELECT sc.id, sc.anchor_id, sc.content, sc.created_at,
              u.full_name, u.username
       FROM section_comments sc
       JOIN users u ON u.id = sc.user_id
       WHERE sc.event_id = $1 AND sc.section_id = $2
       ORDER BY sc.created_at`,
      [event_id, section_id]
    );
    res.json(rows.map(r => ({
      id: r.id,
      anchorId: r.anchor_id,
      content: r.content,
      createdAt: r.created_at,
      userName: r.full_name,
      username: r.username,
    })));
  } catch (err) {
    console.error('List comments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/workflow/comments
router.post('/', requireAuth, async (req, res) => {
  try {
    const { eventId, sectionId, anchorId, content } = req.body;
    const { rows } = await db.query(
      `INSERT INTO section_comments (event_id, section_id, user_id, anchor_id, content)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [eventId, sectionId, req.user.id, anchorId || null, content]
    );
    res.status(201).json({ id: rows[0].id, success: true });
  } catch (err) {
    console.error('Create comment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/workflow/comments/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM section_comments WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete comment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
