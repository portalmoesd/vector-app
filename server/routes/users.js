const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  asTrimmedString,
  asOptionalTrimmedString,
  asPositiveInt,
  asPositiveIntArray,
  asEnum,
  asBoolean,
  asEmail,
  asUsername,
  validationError,
} = require('../helpers/validation');

const router = express.Router();
const USER_ROLES = ['ADMIN', 'PROTOCOL', 'DEPUTY', 'SUPERVISOR', 'SUPER_COLLABORATOR', 'COLLABORATOR', 'ANALYST'];

function validatePassword(value, field, required) {
  if (!value && !required) return { value: null };
  if (typeof value !== 'string' || value.length < 8) {
    return { error: `${field} must be at least 8 characters` };
  }
  if (value.length > 200) return { error: `${field} must be 200 characters or fewer` };
  return { value };
}

// GET /api/users — list all users (admin only)
router.get('/', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.full_name, u.username, u.email, u.role,
              u.department_id, u.is_external, u.entity_name, u.must_change_password,
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
      entityName: r.entity_name,
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
    const fullName = asTrimmedString(req.body.fullName, 'fullName', { required: true, max: 200 });
    if (fullName.error) return validationError(res, fullName.error);
    const username = asUsername(req.body.username, 'username', { required: true });
    if (username.error) return validationError(res, username.error);
    const email = asEmail(req.body.email, 'email', { required: true, max: 200 });
    if (email.error) return validationError(res, email.error);
    const password = validatePassword(req.body.password, 'password', true);
    if (password.error) return validationError(res, password.error);
    const role = asEnum(req.body.role, 'role', USER_ROLES);
    if (role.error) return validationError(res, role.error);
    const isExternal = asBoolean(req.body.isExternal, 'isExternal');
    if (isExternal.error) return validationError(res, isExternal.error);
    const departmentId = asPositiveInt(req.body.departmentId, 'departmentId', { required: false });
    if (departmentId.error) return validationError(res, departmentId.error);
    const entityName = asOptionalTrimmedString(req.body.entityName, 'entityName', { max: 200 });
    if (entityName.error) return validationError(res, entityName.error);
    const countryIds = asPositiveIntArray(req.body.countryIds, 'countryIds');
    if (countryIds.error) return validationError(res, countryIds.error);

    // External users have an entity name and no department; internal users
    // have a department and no entity. Normalise here so the DB never
    // ends up with a stale department_id on an external user (or vice versa).
    const ext = isExternal.value;
    const dept = ext ? null : departmentId.value;
    const entity = ext ? entityName.value : null;

    const hash = await bcrypt.hash(password.value, 10);
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `INSERT INTO users (full_name, username, email, password_hash, role, department_id, is_external, entity_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [fullName.value, username.value, email.value, hash, role.value, dept, ext, entity]
      );

      const userId = rows[0].id;

      // Assign countries for Collaborator/Super-Collaborator
      if (countryIds.value.length > 0) {
        for (const cId of countryIds.value) {
          await client.query(
            'INSERT INTO country_assignments (user_id, country_id) VALUES ($1, $2)',
            [userId, cId]
          );
        }
      }

      await client.query('COMMIT');
      res.status(201).json({ id: userId, success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/users/:id — update user (admin only)
router.patch('/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const userId = asPositiveInt(req.params.id, 'id');
    if (userId.error) return validationError(res, userId.error);

    const sets = [];
    const params = [];
    let idx = 1;

    if (req.body.fullName !== undefined) {
      const fullName = asTrimmedString(req.body.fullName, 'fullName', { required: true, max: 200 });
      if (fullName.error) return validationError(res, fullName.error);
      sets.push(`full_name = $${idx++}`); params.push(fullName.value);
    }
    if (req.body.email !== undefined) {
      const email = asEmail(req.body.email, 'email', { required: true, max: 200 });
      if (email.error) return validationError(res, email.error);
      sets.push(`email = $${idx++}`); params.push(email.value);
    }
    if (req.body.role !== undefined) {
      const role = asEnum(req.body.role, 'role', USER_ROLES);
      if (role.error) return validationError(res, role.error);
      sets.push(`role = $${idx++}`); params.push(role.value);
    }

    // Department / entity / external are coupled: external users have an
    // entity name and no department, internal users have a department and
    // no entity. When isExternal is in the payload, normalise all three
    // together so the DB never stores both at once.
    if (req.body.isExternal !== undefined) {
      const isExternal = asBoolean(req.body.isExternal, 'isExternal');
      if (isExternal.error) return validationError(res, isExternal.error);
      const ext = isExternal.value;
      sets.push(`is_external = $${idx++}`); params.push(ext);
      if (ext) {
        const entityName = asOptionalTrimmedString(req.body.entityName, 'entityName', { max: 200 });
        if (entityName.error) return validationError(res, entityName.error);
        sets.push(`department_id = $${idx++}`); params.push(null);
        sets.push(`entity_name = $${idx++}`); params.push(entityName.value);
      } else {
        const departmentId = asPositiveInt(req.body.departmentId, 'departmentId', { required: false });
        if (departmentId.error) return validationError(res, departmentId.error);
        sets.push(`department_id = $${idx++}`); params.push(departmentId.value);
        sets.push(`entity_name = $${idx++}`); params.push(null);
      }
    } else if (req.body.departmentId !== undefined) {
      const departmentId = asPositiveInt(req.body.departmentId, 'departmentId', { required: false });
      if (departmentId.error) return validationError(res, departmentId.error);
      sets.push(`department_id = $${idx++}`); params.push(departmentId.value);
    }

    if (req.body.password) {
      const password = validatePassword(req.body.password, 'password', false);
      if (password.error) return validationError(res, password.error);
      const hash = await bcrypt.hash(password.value, 10);
      sets.push(`password_hash = $${idx++}`);
      params.push(hash);
      sets.push(`must_change_password = true`);
    }

    const countryIds = req.body.countryIds !== undefined
      ? asPositiveIntArray(req.body.countryIds, 'countryIds')
      : null;
    if (countryIds && countryIds.error) return validationError(res, countryIds.error);
    if (sets.length === 0 && !countryIds) {
      return validationError(res, 'At least one field is required');
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: [existingUser] } = await client.query(
        'SELECT id FROM users WHERE id = $1',
        [userId.value]
      );
      if (!existingUser) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'User not found' });
      }

      if (sets.length > 0) {
        sets.push('updated_at = now()');
        params.push(userId.value);
        await client.query(
          `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx}`,
          params
        );
      }

      // Update country assignments if provided
      if (countryIds) {
        await client.query('DELETE FROM country_assignments WHERE user_id = $1', [userId.value]);
        if (countryIds.value.length > 0) {
          for (const cId of countryIds.value) {
            await client.query(
              'INSERT INTO country_assignments (user_id, country_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [userId.value, cId]
            );
          }
        }
      }

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/:id/countries — get country assignments for a user
router.get('/:id/countries', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const userId = asPositiveInt(req.params.id, 'id');
    if (userId.error) return validationError(res, userId.error);
    const { rows } = await db.query(
      `SELECT c.id, c.name_en, c.code
       FROM country_assignments ca
       JOIN countries c ON c.id = ca.country_id
       WHERE ca.user_id = $1
       ORDER BY c.name_en`,
      [userId.value]
    );
    res.json(rows.map(r => ({ id: r.id, nameEn: r.name_en, code: r.code })));
  } catch (err) {
    console.error('Get user countries error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
