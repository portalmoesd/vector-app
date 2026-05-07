#!/usr/bin/env node

/**
 * Create an admin user in production without requiring ALLOW_DEFAULT_SEED_USERS.
 *
 * Usage:
 *   ADMIN_USERNAME=admin ADMIN_PASSWORD=changeme DATABASE_URL=postgres://... node scripts/create-admin.js
 *
 * On Render, run this as a one-off command via the Shell tab.
 */

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const DATABASE_URL = process.env.DATABASE_URL;
const USERNAME = process.env.ADMIN_USERNAME || 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD;
const FULL_NAME = process.env.ADMIN_FULL_NAME || 'System Administrator';
const EMAIL = process.env.ADMIN_EMAIL || `${USERNAME}@vector-portal.local`;

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}
if (!PASSWORD) {
  console.error('ADMIN_PASSWORD is required.');
  process.exit(1);
}

async function main() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const hash = await bcrypt.hash(PASSWORD, 10);
    const { rowCount } = await pool.query(
      `INSERT INTO users (full_name, username, email, password_hash, role, must_change_password)
       VALUES ($1, $2, $3, $4, 'ADMIN', true)
       ON CONFLICT (username) DO NOTHING`,
      [FULL_NAME, USERNAME, EMAIL, hash]
    );

    if (rowCount === 1) {
      console.log(`Admin user "${USERNAME}" created. Password change required on first login.`);
    } else {
      console.log(`User "${USERNAME}" already exists. No changes made.`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
