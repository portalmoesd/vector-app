const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/departments
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, name_en, is_external FROM departments ORDER BY is_external, name'
    );
    res.json(rows.map(r => ({
      id: r.id,
      name: r.name,
      nameEn: r.name_en,
      isExternal: r.is_external,
    })));
  } catch (err) {
    console.error('List departments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/departments (admin only)
router.post('/', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const { name, nameEn, isExternal } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const { rows } = await db.query(
      'INSERT INTO departments (name, name_en, is_external) VALUES ($1, $2, $3) RETURNING id',
      [name, nameEn || null, isExternal || false]
    );
    res.status(201).json({ id: rows[0].id, success: true });
  } catch (err) {
    console.error('Create department error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/departments/grouped — departments grouped by deputy for picker UI
router.get('/grouped', requireAuth, async (req, res) => {
  try {
    const { rows: depts } = await db.query(
      'SELECT id, name, name_en, is_external FROM departments ORDER BY name_en'
    );

    // Get deputy → department mapping through supervisor links
    const { rows: links } = await db.query(
      `SELECT DISTINCT d.id AS deputy_id, d.full_name AS deputy_name,
              dept.id AS department_id
       FROM deputy_supervisor_links dsl
       JOIN users d ON d.id = dsl.deputy_id
       JOIN users s ON s.id = dsl.supervisor_id
       JOIN departments dept ON dept.id = s.department_id
       WHERE s.department_id IS NOT NULL
       ORDER BY d.full_name`
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
    const unassigned = depts
      .filter(d => !assignedDeptIds.has(d.id))
      .map(d => d.id);

    res.json({
      departments: depts.map(d => ({
        id: d.id,
        name: d.name,
        nameEn: d.name_en,
        isExternal: d.is_external,
      })),
      deputies,
      unassignedDepartmentIds: unassigned,
    });
  } catch (err) {
    console.error('Grouped departments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
