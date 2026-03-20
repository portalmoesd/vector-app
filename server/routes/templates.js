const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/templates — list current user's templates
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows: templates } = await db.query(
      `SELECT id, name, document_submitter_role, curator_required, created_at
       FROM event_templates WHERE created_by_id = $1 ORDER BY name`,
      [req.user.id]
    );

    // Enrich with sections
    const result = [];
    for (const t of templates) {
      const { rows: sections } = await db.query(
        `SELECT ets.id, ets.title, ets.sort_order,
                array_agg(etsd.department_id) AS department_ids
         FROM event_template_sections ets
         LEFT JOIN event_template_section_departments etsd ON etsd.template_section_id = ets.id
         WHERE ets.template_id = $1
         GROUP BY ets.id
         ORDER BY ets.sort_order`,
        [t.id]
      );

      result.push({
        id: t.id,
        name: t.name,
        documentSubmitterRole: t.document_submitter_role,
        curatorRequired: t.curator_required,
        createdAt: t.created_at,
        sections: sections.map(s => ({
          id: s.id,
          title: s.title,
          sortOrder: s.sort_order,
          departmentIds: (s.department_ids || []).filter(Boolean),
        })),
      });
    }

    res.json(result);
  } catch (err) {
    console.error('List templates error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/templates — create template
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, documentSubmitterRole, curatorRequired, sections } = req.body;
    if (!name || !documentSubmitterRole) {
      return res.status(400).json({ error: 'name and documentSubmitterRole are required' });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: [template] } = await client.query(
        `INSERT INTO event_templates (name, created_by_id, document_submitter_role, curator_required)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [name, req.user.id, documentSubmitterRole, curatorRequired || false]
      );

      if (sections && sections.length > 0) {
        for (let i = 0; i < sections.length; i++) {
          const sec = sections[i];
          const { rows: [tplSec] } = await client.query(
            `INSERT INTO event_template_sections (template_id, title, sort_order)
             VALUES ($1, $2, $3) RETURNING id`,
            [template.id, sec.title, sec.sortOrder || i]
          );

          if (sec.departmentIds && sec.departmentIds.length > 0) {
            for (const deptId of sec.departmentIds) {
              await client.query(
                `INSERT INTO event_template_section_departments (template_section_id, department_id)
                 VALUES ($1, $2)`,
                [tplSec.id, deptId]
              );
            }
          }
        }
      }

      await client.query('COMMIT');
      res.status(201).json({ id: template.id, success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Create template error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/templates/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM event_templates WHERE id = $1 AND created_by_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Template not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete template error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
