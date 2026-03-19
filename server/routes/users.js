const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/users — list all users (admin only)
router.get('/', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.full_name, u.username, u.email, u.role,
              u.department_id, u.is_external, u.must_change_password,
              d.name AS department_name
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       ORDER BY u.full_name`
    );
    res.json(rows.map(r => ({
      id: r.id,
      fullName: r.full_name,
      username: r.username,
      email: r.email,
      role: r.role,
      departmentId: r.department_id,
      departmentName: r.department_name,
      isExternal: r.is_external,
      mustChangePassword: r.must_change_password,
    })));
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users — create user (admin only)
router.post('/', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const { fullName, username, email, password, role, departmentId, isExternal } = req.body;
    if (!fullName || !username || !email || !password || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      `INSERT INTO users (full_name, username, email, password_hash, role, department_id, is_external)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [fullName, username, email, hash, role, departmentId || null, isExternal || false]
    );

    res.status(201).json({ id: rows[0].id, success: true });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
