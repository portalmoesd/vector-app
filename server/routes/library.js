const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/library — list completed/archived events scoped to user participation
router.get('/', requireAuth, async (req, res) => {
  try {
    // Participation-scoped: user must have touched at least one section
    const { rows } = await db.query(
      `SELECT DISTINCT e.id, e.title, e.language, e.ended_at,
              c.name_en AS country_name, c.code AS country_code,
              ds.full_name AS document_submitter_name
       FROM events e
       JOIN countries c ON c.id = e.country_id
       JOIN users ds ON ds.id = e.document_submitter_id
       LEFT JOIN section_history sh ON sh.event_id = e.id
       WHERE e.status = 'COMPLETED'
         AND (
           sh.user_id = $1
           OR e.document_submitter_id = $1
           OR e.deputy_id = $1
           OR e.created_by_id = $1
           OR $2 = 'ADMIN'
         )
       ORDER BY e.ended_at DESC`,
      [req.user.id, req.user.role]
    );
    res.json(rows.map(r => ({
      id: r.id,
      title: r.title,
      language: r.language,
      endedAt: r.ended_at,
      countryName: r.country_name,
      countryCode: r.country_code,
      documentSubmitterName: r.document_submitter_name,
    })));
  } catch (err) {
    console.error('Library list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/library/:eventId/document — full document with all section content
router.get('/:eventId/document', requireAuth, async (req, res) => {
  try {
    const eventId = req.params.eventId;

    const { rows: [event] } = await db.query(
      `SELECT e.title, e.language, e.ended_at, c.name_en AS country_name
       FROM events e JOIN countries c ON c.id = e.country_id
       WHERE e.id = $1 AND (e.status = 'COMPLETED' OR e.status = 'ARCHIVED')`,
      [eventId]
    );
    if (!event) return res.status(404).json({ error: 'Document not found' });

    const { rows: sections } = await db.query(
      `SELECT s.id, s.title, s.sort_order, sc.html_content
       FROM sections s
       JOIN section_content sc ON sc.section_id = s.id AND sc.event_id = s.event_id
       WHERE s.event_id = $1
       ORDER BY s.sort_order`,
      [eventId]
    );

    res.json({
      eventId: parseInt(eventId),
      title: event.title,
      language: event.language,
      countryName: event.country_name,
      endedAt: event.ended_at,
      sections: sections.map(s => ({
        id: s.id,
        title: s.title,
        sortOrder: s.sort_order,
        htmlContent: s.html_content,
      })),
    });
  } catch (err) {
    console.error('Library document error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/library/:eventId/files — list all files for an event (across all sections)
router.get('/:eventId/files', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT sf.id, sf.section_id, sf.original_name, sf.mime_type, sf.size,
              sf.uploaded_by_name, sf.created_at,
              s.title AS section_title
       FROM section_files sf
       LEFT JOIN sections s ON s.id = sf.section_id
       WHERE sf.event_id = $1
       ORDER BY sf.created_at DESC`,
      [req.params.eventId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Library files error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
