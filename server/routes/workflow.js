const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /api/workflow/save
router.post('/save', requireAuth, async (req, res) => {
  try {
    const { eventId, sectionId, htmlContent } = req.body;
    if (!eventId || !sectionId) {
      return res.status(400).json({ error: 'eventId and sectionId are required' });
    }

    await db.query(
      `UPDATE section_content
       SET html_content = $1,
           last_updated_by_user_id = $2,
           last_updated_at = now(),
           last_content_edited_at = now(),
           last_content_edited_by_user_id = $2
       WHERE event_id = $3 AND section_id = $4`,
      [htmlContent || '', req.user.id, eventId, sectionId]
    );

    // Record in history
    await db.query(
      `INSERT INTO section_history (event_id, section_id, action, from_status, to_status, user_id, user_name, user_role)
       SELECT $1, $2, 'saved', sc.status, sc.status, $3, u.full_name, $4
       FROM section_content sc, users u
       WHERE sc.event_id = $1 AND sc.section_id = $2 AND u.id = $3`,
      [eventId, sectionId, req.user.id, req.user.role]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Save error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/workflow/status-grid?event_id=X
router.get('/status-grid', requireAuth, async (req, res) => {
  try {
    const eventId = req.query.event_id;
    if (!eventId) return res.status(400).json({ error: 'event_id is required' });

    const { rows: [event] } = await db.query(
      'SELECT document_submitter_role, curator_required FROM events WHERE id = $1',
      [eventId]
    );
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const { rows: sections } = await db.query(
      `SELECT s.id AS section_id, s.title AS section_label,
              sc.status, sc.status_comment, sc.last_updated_at,
              sc.original_submitter_role, sc.return_target_role,
              u.full_name AS last_updated_by
       FROM sections s
       LEFT JOIN section_content sc ON sc.section_id = s.id AND sc.event_id = s.event_id
       LEFT JOIN users u ON u.id = sc.last_updated_by_user_id
       WHERE s.event_id = $1
       ORDER BY s.sort_order`,
      [eventId]
    );

    res.json({
      event_id: parseInt(eventId),
      documentSubmitterRole: event.document_submitter_role,
      curatorRequired: event.curator_required,
      sections: sections.map(s => ({
        sectionId: s.section_id,
        sectionLabel: s.section_label,
        status: s.status || 'draft',
        statusComment: s.status_comment,
        lastUpdatedAt: s.last_updated_at,
        lastUpdatedBy: s.last_updated_by,
        originalSubmitterRole: s.original_submitter_role,
        returnTargetRole: s.return_target_role,
      })),
    });
  } catch (err) {
    console.error('Status grid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
