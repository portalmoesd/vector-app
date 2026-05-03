const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { canAccessSection } = require('../helpers/access');

const router = express.Router();

// GET /api/workflow/section-history?event_id=X&section_id=Y
router.get('/section-history', requireAuth, async (req, res) => {
  try {
    const { event_id, section_id } = req.query;
    if (!event_id || !section_id) {
      return res.status(400).json({ error: 'event_id and section_id are required' });
    }
    if (!(await canAccessSection(req.user, event_id, section_id))) {
      return res.status(403).json({ error: 'Not authorized to access this section' });
    }

    const { rows } = await db.query(
      `SELECT id, action, from_status, to_status, user_name, user_role, note, acted_at
       FROM section_history
       WHERE event_id = $1 AND section_id = $2
       ORDER BY acted_at`,
      [event_id, section_id]
    );

    res.json({
      history: rows.map(r => ({
        id: r.id,
        action: r.action,
        fromStatus: r.from_status,
        toStatus: r.to_status,
        userName: r.user_name,
        userRole: r.user_role,
        note: r.note,
        actedAt: r.acted_at,
      })),
    });
  } catch (err) {
    console.error('Section history error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
