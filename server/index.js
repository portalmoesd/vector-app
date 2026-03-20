const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');

const app = express();

// ── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));

// ── API Routes ──────────────────────────────────────────────────────────────

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/departments', require('./routes/departments'));
app.use('/api/countries', require('./routes/countries'));
app.use('/api/events', require('./routes/events'));
app.use('/api/sections', require('./routes/sections'));
app.use('/api/workflow', require('./routes/workflow'));
app.use('/api/workflow/comments', require('./routes/comments'));
app.use('/api/workflow/files', require('./routes/files'));
app.use('/api/workflow', require('./routes/history'));
app.use('/api/library', require('./routes/library'));

// ── Auto-migrate & seed on startup ──────────────────────────────────────────

const fs = require('fs');
const bcrypt = require('bcryptjs');
const db = require('./db');

async function migrate() {
  try {
    console.log('Running schema migration...');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await db.query(schema);
    console.log('Schema OK.');

    // Add name_en column if missing (migration for existing databases)
    await db.query(`
      DO $$ BEGIN
        ALTER TABLE departments ADD COLUMN IF NOT EXISTS name_en VARCHAR(500);
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
    `);

    // Fix: ensure all ministry departments are marked internal
    await db.query('UPDATE departments SET is_external = false WHERE is_external = true');

    // Seed departments if empty
    const { rows: [{ count: deptCount }] } = await db.query('SELECT count(*)::int AS count FROM departments');
    if (deptCount === 0) {
      console.log('Seeding departments...');
      const depts = require('./data/departments.json');
      for (const d of depts) {
        await db.query(
          'INSERT INTO departments (name, name_en, is_external) VALUES ($1, $2, $3)',
          [d.name, d.name_en, d.external]
        );
      }
      console.log(`Seeded ${depts.length} departments.`);
    }

    // Seed countries if empty
    const { rows: [{ count: countryCount }] } = await db.query('SELECT count(*)::int AS count FROM countries');
    if (countryCount === 0) {
      console.log('Seeding countries...');
      const countries = require('./data/countries.json');
      for (const c of countries) {
        await db.query(
          'INSERT INTO countries (name_en, code) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING',
          [c.name, c.code]
        );
      }
      console.log(`Seeded ${countries.length} countries.`);
    }

    // Seed admin user if no users exist
    const { rows: [{ count: userCount }] } = await db.query('SELECT count(*)::int AS count FROM users');
    if (userCount === 0) {
      console.log('Creating default admin user...');
      const hash = await bcrypt.hash('admin123', 10);
      await db.query(
        `INSERT INTO users (full_name, username, email, password_hash, role, must_change_password)
         VALUES ($1, $2, $3, $4, $5, true)`,
        ['System Administrator', 'admin', 'admin@vector-portal.gov.ge', hash, 'ADMIN']
      );
      console.log('Admin user created (admin / admin123).');

      // Seed ministry staff
      console.log('Seeding ministry staff...');
      const staffList = require('./data/users.json');
      const defaultHash = await bcrypt.hash('vector2026', 10);

      // Build department name → id lookup
      const { rows: allDepts } = await db.query('SELECT id, name_en FROM departments');
      const deptMap = {};
      for (const d of allDepts) deptMap[d.name_en] = d.id;

      // Get all country IDs for assignment
      const { rows: allCountries } = await db.query('SELECT id FROM countries');
      const countryIds = allCountries.map(c => c.id);

      for (const s of staffList) {
        const username = s.email.split('@')[0].toLowerCase().replace(/[^a-z0-9.]/g, '');
        const deptId = deptMap[s.dept] || null;

        const { rows: [newUser] } = await db.query(
          `INSERT INTO users (full_name, username, email, password_hash, role, department_id, must_change_password)
           VALUES ($1, $2, $3, $4, $5, $6, true)
           ON CONFLICT (username) DO NOTHING
           RETURNING id`,
          [s.fullName, username, s.email, defaultHash, s.role, deptId]
        );

        // Assign all countries to COLLABORATOR and SUPER_COLLABORATOR
        if (newUser && (s.role === 'COLLABORATOR' || s.role === 'SUPER_COLLABORATOR')) {
          for (const cId of countryIds) {
            await db.query(
              'INSERT INTO country_assignments (user_id, country_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [newUser.id, cId]
            );
          }
        }
      }
      console.log(`Seeded ${staffList.length} staff members.`);
    }
  } catch (err) {
    console.error('Migration error:', err);
  }
}

// ── Start ───────────────────────────────────────────────────────────────────

migrate().then(() => {
  app.listen(config.port, () => {
    console.log(`Vector Portal running on port ${config.port}`);
  });
});

module.exports = app;
