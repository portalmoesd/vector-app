const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/library — list approved documents (scoped to user participation)
router.get('/', requireAuth, async (req, res) => {
  try {
    // TODO: implement participation-scoped filtering
    const { rows } = await db.query(
      `SELECT e.id, e.title, e.language, e.ended_at,
              c.name_en AS country_name, c.code AS country_code,
              ds.full_name AS document_submitter_name
       FROM events e
       JOIN countries c ON c.id = e.country_id
       JOIN users ds ON ds.id = e.document_submitter_id
       WHERE e.status = 'COMPLETED' OR e.status = 'ARCHIVED'
       ORDER BY e.ended_at DESC`
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

module.exports = router;
