const express = require('express');
const db = require('../db');
const { requireAuth, denyAnalyst } = require('../middleware/auth');
const {
  asTrimmedString,
  asPositiveInt,
  asPositiveIntArray,
  asEnum,
  asBoolean,
  validationError,
} = require('../helpers/validation');
const logger = require('../logger');

const router = express.Router();
const DS_ROLES = ['DEPUTY', 'SUPERVISOR', 'SUPER_COLLABORATOR'];

function parseTemplateSections(rawSections) {
  if (rawSections === undefined || rawSections === null) return { value: [] };
  if (!Array.isArray(rawSections)) return { error: 'sections must be an array' };
  if (rawSections.length > 100) return { error: 'sections must include 100 sections or fewer' };

  const sections = [];
  for (const rawSection of rawSections) {
    const title = asTrimmedString(rawSection && rawSection.title, 'section title', { required: true, max: 500 });
    if (title.error) return title;
    const departmentIds = asPositiveIntArray(rawSection ? rawSection.departmentIds : undefined, 'departmentIds');
    if (departmentIds.error) return departmentIds;
    sections.push({ title: title.value, departmentIds: departmentIds.value });
  }
  return { value: sections };
}

// GET /api/templates — list templates visible to the current user
// Returns: default templates + templates created by the current user
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows: templates } = await db.query(
      `SELECT et.id, et.name, et.document_submitter_role, et.curator_required,
              et.is_default, et.created_at, et.created_by_id,
              COALESCE(u.full_name, 'System') AS created_by_name
       FROM event_templates et
       LEFT JOIN users u ON u.id = et.created_by_id
       WHERE et.is_default = true OR et.created_by_id = $1
       ORDER BY et.is_default DESC, et.name`,
      [req.user.id]
    );

    const templateIds = templates.map((t) => t.id);
    const sectionsByTemplate = new Map();

    if (templateIds.length > 0) {
      const { rows: sections } = await db.query(
        `SELECT ets.template_id, ets.id, ets.title, ets.sort_order,
                array_agg(etsd.department_id) AS department_ids
         FROM event_template_sections ets
         LEFT JOIN event_template_section_departments etsd ON etsd.template_section_id = ets.id
         WHERE ets.template_id = ANY($1)
         GROUP BY ets.template_id, ets.id
         ORDER BY ets.template_id, ets.sort_order`,
        [templateIds]
      );

      for (const s of sections) {
        if (!sectionsByTemplate.has(s.template_id)) {
          sectionsByTemplate.set(s.template_id, []);
        }
        sectionsByTemplate.get(s.template_id).push({
          id: s.id,
          title: s.title,
          sortOrder: s.sort_order,
          departmentIds: (s.department_ids || []).filter(Boolean),
        });
      }
    }

    const result = templates.map((t) => ({
      id: t.id,
      name: t.name,
      documentSubmitterRole: t.document_submitter_role,
      curatorRequired: t.curator_required,
      isDefault: t.is_default,
      createdAt: t.created_at,
      createdById: t.created_by_id,
      createdByName: t.created_by_name,
      sections: sectionsByTemplate.get(t.id) || [],
    }));

    res.json(result);
  } catch (err) {
    logger.error({ err }, 'List templates error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/templates — create template
router.post('/', requireAuth, denyAnalyst, async (req, res) => {
  try {
    const name = asTrimmedString(req.body.name, 'name', { required: true, max: 300 });
    if (name.error) return validationError(res, name.error);
    const documentSubmitterRole = asEnum(req.body.documentSubmitterRole, 'documentSubmitterRole', DS_ROLES, {
      default: 'DEPUTY',
    });
    if (documentSubmitterRole.error) return validationError(res, documentSubmitterRole.error);
    const curatorRequired = asBoolean(req.body.curatorRequired, 'curatorRequired');
    if (curatorRequired.error) return validationError(res, curatorRequired.error);
    const sections = parseTemplateSections(req.body.sections);
    if (sections.error) return validationError(res, sections.error);

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const {
        rows: [template],
      } = await client.query(
        `INSERT INTO event_templates (name, created_by_id, document_submitter_role, curator_required, is_default)
         VALUES ($1, $2, $3, $4, false) RETURNING id`,
        [name.value, req.user.id, documentSubmitterRole.value, curatorRequired.value]
      );

      if (sections.value.length > 0) {
        for (let i = 0; i < sections.value.length; i++) {
          const sec = sections.value[i];
          const {
            rows: [tplSec],
          } = await client.query(
            `INSERT INTO event_template_sections (template_id, title, sort_order)
             VALUES ($1, $2, $3) RETURNING id`,
            [template.id, sec.title, i]
          );

          if (sec.departmentIds.length > 0) {
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
    logger.error({ err }, 'Create template error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/templates/:id — delete own template (not default)
router.delete('/:id', requireAuth, denyAnalyst, async (req, res) => {
  try {
    const templateId = asPositiveInt(req.params.id, 'id');
    if (templateId.error) return validationError(res, templateId.error);
    const result = await db.query(
      'DELETE FROM event_templates WHERE id = $1 AND created_by_id = $2 AND is_default = false',
      [templateId.value, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Template not found or cannot be deleted' });
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Delete template error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
