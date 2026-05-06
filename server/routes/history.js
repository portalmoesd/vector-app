const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { canAccessSection } = require('../helpers/access');
const { asPositiveInt, validationError } = require('../helpers/validation');
const logger = require('../logger');

const router = express.Router();

// GET /api/workflow/section-history?event_id=X&section_id=Y
router.get('/section-history', requireAuth, async (req, res) => {
  try {
    const eventId = asPositiveInt(req.query.event_id, 'event_id');
    if (eventId.error) return validationError(res, eventId.error);
    const sectionId = asPositiveInt(req.query.section_id, 'section_id');
    if (sectionId.error) return validationError(res, sectionId.error);
    if (!(await canAccessSection(req.user, eventId.value, sectionId.value))) {
      return res.status(403).json({ error: 'Not authorized to access this section' });
    }

    const { rows } = await db.query(
      `SELECT id, action, from_status, to_status, user_name, user_role, note, acted_at
       FROM section_history
       WHERE event_id = $1 AND section_id = $2
       ORDER BY acted_at`,
      [eventId.value, sectionId.value]
    );

    res.json({
      history: rows.map((r) => ({
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
    logger.error({ err }, 'Section history error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
