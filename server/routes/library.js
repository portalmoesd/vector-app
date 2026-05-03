const express = require('express');
const db = require('../db');
const { requireAuth, denyAnalyst } = require('../middleware/auth');
const { canAccessEvent } = require('../helpers/access');
const { asPositiveInt, validationError } = require('../helpers/validation');

const router = express.Router();

// GET /api/library — list completed/archived events scoped to user participation
router.get('/', requireAuth, async (req, res) => {
  try {
    // Participation-scoped: user must have touched at least one section
    const { rows } = await db.query(
      `SELECT DISTINCT e.id, e.title, e.language, e.ended_at,
              c.name_en AS country_name, c.code AS country_code,
              ds.full_name AS document_submitter_name,
              e.document_submitter_id
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
      documentSubmitterId: r.document_submitter_id,
    })));
  } catch (err) {
    console.error('Library list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/library/:eventId/document — full document with all section content
router.get('/:eventId/document', requireAuth, async (req, res) => {
  try {
    const eventId = asPositiveInt(req.params.eventId, 'eventId');
    if (eventId.error) return validationError(res, eventId.error);
    if (!(await canAccessEvent(req.user, eventId.value))) {
      return res.status(403).json({ error: 'Not authorized to access this document' });
    }

    const { rows: [event] } = await db.query(
      `SELECT e.title, e.language, e.ended_at, c.name_en AS country_name
       FROM events e JOIN countries c ON c.id = e.country_id
       WHERE e.id = $1 AND (e.status = 'COMPLETED' OR e.status = 'ARCHIVED')`,
      [eventId.value]
    );
    if (!event) return res.status(404).json({ error: 'Document not found' });

    const { rows: sections } = await db.query(
      `SELECT s.id, s.title, s.sort_order, sc.html_content
       FROM sections s
       JOIN section_content sc ON sc.section_id = s.id AND sc.event_id = s.event_id
       WHERE s.event_id = $1
       ORDER BY s.sort_order`,
      [eventId.value]
    );

    res.json({
      eventId: eventId.value,
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
    const eventId = asPositiveInt(req.params.eventId, 'eventId');
    if (eventId.error) return validationError(res, eventId.error);
    if (!(await canAccessEvent(req.user, eventId.value))) {
      return res.status(403).json({ error: 'Not authorized to access this event' });
    }

    const result = await db.query(
      `SELECT sf.id, sf.section_id, sf.original_name, sf.mime_type, sf.size,
              sf.uploaded_by_name, sf.created_at,
              s.title AS section_title
       FROM section_files sf
       LEFT JOIN sections s ON s.id = sf.section_id
       WHERE sf.event_id = $1
       ORDER BY sf.created_at DESC`,
      [eventId.value]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Library files error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/library/:eventId/reopen — DS-only. Flip a published event
// back to IN_PROGRESS so the Document Submitter can pull sections, edit,
// and re-publish. Mirrors workflow.js's /send-to-library guards but in
// reverse: requires status === 'COMPLETED' and only the DS may invoke.
router.post('/:eventId/reopen', requireAuth, denyAnalyst, async (req, res) => {
  try {
    const eventId = asPositiveInt(req.params.eventId, 'eventId');
    if (eventId.error) return validationError(res, eventId.error);

    const { rows: [event] } = await db.query(
      'SELECT document_submitter_id, status FROM events WHERE id = $1',
      [eventId.value]
    );
    if (!event) return res.status(404).json({ error: 'Event not found' });

    if (event.document_submitter_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the Document Submitter can reopen a published event' });
    }
    if (event.status !== 'COMPLETED') {
      return res.status(400).json({
        error: `Event is ${event.status}, not COMPLETED — nothing to reopen`,
      });
    }

    await db.query(
      `UPDATE events
       SET status = 'IN_PROGRESS', is_active = true, ended_at = NULL, updated_at = now()
       WHERE id = $1`,
      [eventId.value]
    );

    console.log(`[library.reopen] event=${eventId.value} dsUser=${req.user.id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Library reopen error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
