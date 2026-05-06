const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asBoolean, asOptionalTrimmedString, asTrimmedString, validationError } = require('../helpers/validation');
const logger = require('../logger');

const router = express.Router();

// GET /api/departments
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, name_en, is_external FROM departments ORDER BY is_external, name'
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        nameEn: r.name_en,
        isExternal: r.is_external,
      }))
    );
  } catch (err) {
    logger.error({ err }, 'List departments error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/departments (admin only)
router.post('/', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const name = asTrimmedString(req.body.name, 'name', { required: true, max: 200 });
    if (name.error) return validationError(res, name.error);
    const nameEn = asOptionalTrimmedString(req.body.nameEn, 'nameEn', { max: 200 });
    if (nameEn.error) return validationError(res, nameEn.error);
    const isExternal = asBoolean(req.body.isExternal, 'isExternal');
    if (isExternal.error) return validationError(res, isExternal.error);

    const { rows } = await db.query(
      'INSERT INTO departments (name, name_en, is_external) VALUES ($1, $2, $3) RETURNING id',
      [name.value, nameEn.value, isExternal.value]
    );
    res.status(201).json({ id: rows[0].id, success: true });
  } catch (err) {
    logger.error({ err }, 'Create department error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/departments/grouped — departments grouped by deputy for picker UI
router.get('/grouped', requireAuth, async (req, res) => {
  try {
    const { rows: depts } = await db.query('SELECT id, name, name_en, is_external FROM departments ORDER BY name_en');

    // Get deputy → department mapping through direct deputy-department links
    const { rows: links } = await db.query(
      `SELECT ddl.deputy_id, u.full_name AS deputy_name,
              ddl.department_id
       FROM deputy_department_links ddl
       JOIN users u ON u.id = ddl.deputy_id
       ORDER BY u.full_name, ddl.department_id`
    );

    // Group departments by deputy
    const deputyMap = new Map();
    const assignedDeptIds = new Set();
    for (const l of links) {
      if (!deputyMap.has(l.deputy_id)) {
        deputyMap.set(l.deputy_id, { deputyName: l.deputy_name, departmentIds: [] });
      }
      deputyMap.get(l.deputy_id).departmentIds.push(l.department_id);
      assignedDeptIds.add(l.department_id);
    }

    const deputies = Array.from(deputyMap.values());

    // Departments not assigned to any deputy
    const unassigned = depts.filter((d) => !assignedDeptIds.has(d.id)).map((d) => d.id);

    res.json({
      departments: depts.map((d) => ({
        id: d.id,
        name: d.name,
        nameEn: d.name_en,
        isExternal: d.is_external,
      })),
      deputies,
      unassignedDepartmentIds: unassigned,
    });
  } catch (err) {
    logger.error({ err }, 'Grouped departments error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
