const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/departments
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, is_external FROM departments ORDER BY name'
    );
    res.json(rows.map(r => ({
      id: r.id,
      name: r.name,
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
    const { name, isExternal } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const { rows } = await db.query(
      'INSERT INTO departments (name, is_external) VALUES ($1, $2) RETURNING id',
      [name, isExternal || false]
    );
    res.status(201).json({ id: rows[0].id, success: true });
  } catch (err) {
    console.error('Create department error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
