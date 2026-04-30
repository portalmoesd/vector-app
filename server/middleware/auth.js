const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Extract and verify JWT from Authorization header.
 * Attaches decoded user to req.user.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Restrict access to specific roles.
 * Usage: requireRole('ADMIN', 'DEPUTY')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

/**
 * Block ANALYST (read-only role) from a mutation route. Pair after
 * requireAuth and before any role-specific guards.
 *
 *   router.post('/x', requireAuth, denyAnalyst, requireRole('ADMIN'), handler)
 *
 * GET routes don't need this — existing role-based filters already
 * yield empty results for ANALYST.
 */
function denyAnalyst(req, res, next) {
  if (req.user?.role === 'ANALYST') {
    return res.status(403).json({ error: 'Read-only role' });
  }
  next();
}

module.exports = { requireAuth, requireRole, denyAnalyst };
