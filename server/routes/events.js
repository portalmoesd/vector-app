const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { canCreateEvent, canEndEvent } = require('../helpers/roles');

const router = express.Router();

// GET /api/events — list events visible to current user
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT e.id, e.title, e.country_id, e.document_submitter_role,
              e.document_submitter_id, e.deputy_id, e.curator_required,
              e.language, e.deadline_date, e.occasion, e.is_active,
              e.ended_at, e.status, e.created_at,
              c.name_en AS country_name, c.code AS country_code,
              ds.full_name AS document_submitter_name
       FROM events e
       JOIN countries c ON c.id = e.country_id
       JOIN users ds ON ds.id = e.document_submitter_id
       ORDER BY e.created_at DESC`
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
      curatorRequired: r.curator_required,
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
router.post('/', requireAuth, async (req, res) => {
  try {
    if (!canCreateEvent(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized to create events' });
    }

    const {
      title, countryId, documentSubmitterRole, documentSubmitterId,
      deputyId, curatorRequired, language, deadlineDate, occasion, sections
    } = req.body;

    if (!title || !countryId || !documentSubmitterRole || !documentSubmitterId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: [event] } = await client.query(
        `INSERT INTO events (title, country_id, document_submitter_role, document_submitter_id,
                             deputy_id, curator_required, language, deadline_date, occasion, created_by_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [title, countryId, documentSubmitterRole, documentSubmitterId,
         deputyId || null, curatorRequired || false, language || 'EN',
         deadlineDate || null, occasion || null, req.user.id]
      );

      if (sections && sections.length > 0) {
        for (let i = 0; i < sections.length; i++) {
          const sec = sections[i];
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

// POST /api/events/:id/end — end an event
router.post('/:id/end', requireAuth, async (req, res) => {
  try {
    if (!canEndEvent(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized to end events' });
    }

    await db.query(
      `UPDATE events SET is_active = false, ended_at = now(), status = 'ARCHIVED', updated_at = now()
       WHERE id = $1`,
      [req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('End event error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
