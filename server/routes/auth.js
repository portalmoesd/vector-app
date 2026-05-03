const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const { createRateLimit } = require('../middleware/rate-limit');
const { asUsername, validationError } = require('../helpers/validation');

const router = express.Router();
const loginRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyPrefix: 'login',
});
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;

function validatePassword(value, field) {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD_LENGTH) {
    return { error: `${field} must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    return { error: `${field} must be ${MAX_PASSWORD_LENGTH} characters or fewer` };
  }
  return { value };
}

function validateRequiredSecret(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    return { error: `${field} is required` };
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    return { error: `${field} must be ${MAX_PASSWORD_LENGTH} characters or fewer` };
  }
  return { value };
}

// POST /api/auth/login
router.post('/login', loginRateLimit, async (req, res) => {
  try {
    const username = asUsername(req.body.username, 'username', { required: true });
    if (username.error) return validationError(res, username.error);
    const password = validateRequiredSecret(req.body.password, 'password');
    if (password.error) return validationError(res, password.error);

    const { rows } = await db.query(
      `SELECT u.id, u.full_name, u.username, u.email, u.password_hash, u.role,
              u.department_id, u.is_external, u.entity_name, u.must_change_password,
              d.name AS department_name
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.username = $1`,
      [username.value]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password.value, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        departmentId: user.department_id,
      },
      config.jwtSecret,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        username: user.username,
        email: user.email,
        role: user.role,
        departmentId: user.department_id,
        departmentName: user.department_name,
        isExternal: user.is_external,
        entityName: user.entity_name,
        mustChangePassword: user.must_change_password,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const currentPassword = validateRequiredSecret(req.body.currentPassword, 'currentPassword');
    if (currentPassword.error) return validationError(res, currentPassword.error);
    const newPassword = validatePassword(req.body.newPassword, 'newPassword');
    if (newPassword.error) return validationError(res, newPassword.error);

    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const valid = await bcrypt.compare(currentPassword.value, rows[0].password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(newPassword.value, 10);
    await db.query(
      'UPDATE users SET password_hash = $1, must_change_password = false, updated_at = now() WHERE id = $2',
      [hash, req.user.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.full_name, u.username, u.email, u.role,
              u.department_id, u.is_external, u.entity_name, u.must_change_password,
              d.name AS department_name
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.id = $1`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = rows[0];
    res.json({
      id: user.id,
      fullName: user.full_name,
      username: user.username,
      email: user.email,
      role: user.role,
      departmentId: user.department_id,
      departmentName: user.department_name,
      isExternal: user.is_external,
      entityName: user.entity_name,
      mustChangePassword: user.must_change_password,
    });
  } catch (err) {
    console.error('Get me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
