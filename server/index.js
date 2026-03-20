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
app.use('/api/admin', require('./routes/admin'));
app.use('/api/templates', require('./routes/templates'));

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

    // Seed admin user if not exists
    const { rows: [{ count: userCount }] } = await db.query('SELECT count(*)::int AS count FROM users');
    const { rows: [{ exists: adminExists }] } = await db.query("SELECT EXISTS(SELECT 1 FROM users WHERE username='admin') AS exists");
    if (!adminExists) {
      console.log('Creating default admin user...');
      const hash = await bcrypt.hash('admin123', 10);
      await db.query(
        `INSERT INTO users (full_name, username, email, password_hash, role, must_change_password)
         VALUES ($1, $2, $3, $4, $5, true)`,
        ['System Administrator', 'admin', 'admin@vector-portal.gov.ge', hash, 'ADMIN']
      );
      console.log('Admin user created (admin / admin123).');
    }

    // Seed ministry staff if not already seeded
    if (userCount <= 1) {
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

    // ── Fix Protocol Department users to PROTOCOL role ────────────────────────
    const { rows: protocolDeptRows } = await db.query(
      "SELECT id FROM departments WHERE name_en = 'Protocol Department' LIMIT 1"
    );
    if (protocolDeptRows.length > 0) {
      const protocolDeptId = protocolDeptRows[0].id;
      const { rowCount } = await db.query(
        `UPDATE users SET role = 'PROTOCOL', updated_at = now()
         WHERE department_id = $1 AND role != 'PROTOCOL' AND role != 'ADMIN'`,
        [protocolDeptId]
      );
      if (rowCount > 0) {
        console.log(`Updated ${rowCount} Protocol Department user(s) to PROTOCOL role.`);
      }
    }

    // ── Remove incorrectly seeded Deputy users from earlier migration ─────────
    const wrongDeputies = ['gjavakhishvili', 'ichikovani', 'lzhvania'];
    for (const uname of wrongDeputies) {
      await db.query(
        "DELETE FROM users WHERE username = $1 AND role = 'DEPUTY'",
        [uname]
      );
    }

    // ── Ensure Deputy users exist (idempotent) ────────────────────────────────
    const deputyUsers = [
      { fullName: 'Nino Enukidze', email: 'nenukidze@moesd.gov.ge', dept: 'Legal Department' },
      { fullName: 'Genadi Arveladze', email: 'garveladze@moesd.gov.ge', dept: 'Foreign Trade Policy Department' },
      { fullName: 'Inga Pkhaladze', email: 'ipkhaladze@moesd.gov.ge', dept: 'Energy Reforms Department' },
      { fullName: 'Tamar Ioseliani', email: 'tioseliani@moesd.gov.ge', dept: 'Transport and Logistics Development Policy Department' },
      { fullName: 'Vakhtang Tsitsadze', email: 'vtsitsadze@moesd.gov.ge', dept: 'Economic Analysis and Reforms Department' },
      { fullName: 'Irakli Nadareishvili', email: 'inadareishvili@moesd.gov.ge', dept: 'Capital Market Development and Pension Reform Department' },
    ];

    const { rows: allDeptsForDeputy } = await db.query('SELECT id, name_en FROM departments');
    const deptMapForDeputy = {};
    for (const d of allDeptsForDeputy) deptMapForDeputy[d.name_en] = d.id;

    const defaultHashDeputy = await bcrypt.hash('vector2026', 10);
    for (const dep of deputyUsers) {
      const username = dep.email.split('@')[0].toLowerCase().replace(/[^a-z0-9.]/g, '');
      const deptId = deptMapForDeputy[dep.dept] || null;
      await db.query(
        `INSERT INTO users (full_name, username, email, password_hash, role, department_id, must_change_password)
         VALUES ($1, $2, $3, $4, 'DEPUTY', $5, true)
         ON CONFLICT (username) DO NOTHING`,
        [dep.fullName, username, dep.email, defaultHashDeputy, deptId]
      );
    }

    // ── Create Deputy–Supervisor links (idempotent) ───────────────────────────
    // Links define which Deputies oversee which Supervisors (from org chart)
    // Note: Minister directly oversees Internal Audit, HR, Strategic Comms, Protocol, Transportation Safety Bureau
    // Those departments report to Minister, not a Deputy — but we still need Deputy links for workflow
    const deputySupervisorLinks = [
      // First Deputy Nino Enukidze: Legal, National Agency of State Property, Spatial and Urban Dev Agency
      { deputy: 'nenukidze', supervisorDepts: [
        'Legal Department',
        'National Agency of State Property',
        'Spatial and Urban Development Agency',
      ]},
      // Deputy Genadi Arveladze: Foreign Trade, Trade Dev & Intl Relations, Construction, Standards, Accreditation, Technical Supervision, Market Surveillance
      { deputy: 'garveladze', supervisorDepts: [
        'Foreign Trade Policy Department',
        'Department of Trade Development and International Economic Relations',
        'Construction Policy Department',
        'Georgian National Agency for Standards and Metrology',
        'The Unified National Body of Accreditation',
        'Technical and Constructions Supervision Agency',
        'Market Surveillance Agency',
      ]},
      // Deputy Inga Pkhaladze: Energy Reforms, Energy Efficiency, Energy Policy, Energy Enterprises, Oil and Gas
      { deputy: 'ipkhaladze', supervisorDepts: [
        'Energy Reforms Department',
        'Energy Efficiency and Renewable Energy Policy and Sustainable Development Department',
        'Energy Policy and Investment Projects Department',
        'Department of Energy Enterprises Management',
        'State Agency of Oil and Gas',
      ]},
      // Deputy Tamar Ioseliani: Transport & Logistics, Comms & IT, Road Safety, Land Transport, Maritime, Civil Aviation, Anaklia Port, Rail Transport
      { deputy: 'tioseliani', supervisorDepts: [
        'Transport and Logistics Development Policy Department',
        'Communications, Information and Modern Technologies Department',
        'Road Safety Department',
        'Land Transport Agency',
        'Maritime Transport Agency',
        'Civil Aviation Agency',
        'Anaklia Deep Sea Port Development Agency',
        'Rail Transport Agency',
      ]},
      // Deputy Vakhtang Tsitsadze: Economic Analysis, Economic Policy, Administrative, Strategic Development
      { deputy: 'vtsitsadze', supervisorDepts: [
        'Economic Analysis and Reforms Department',
        'Economic Policy Department',
        'Administrative Department',
        'Strategic Development Department',
      ]},
      // Deputy Irakli Nadareishvili: Capital Markets, Investment Policy, GITA, Enterprise Georgia, Tourism Admin
      { deputy: 'inadareishvili', supervisorDepts: [
        'Capital Market Development and Pension Reform Department',
        'Investment Policy and Support Department',
        "Georgia's Innovation and Technology Agency",
        'Enterprise Georgia',
        'Georgian National Tourism Administration',
      ]},
    ];

    for (const link of deputySupervisorLinks) {
      const { rows: [deputyUser] } = await db.query(
        'SELECT id FROM users WHERE username = $1',
        [link.deputy]
      );
      if (!deputyUser) continue;

      for (const deptName of link.supervisorDepts) {
        const deptId = deptMapForDeputy[deptName];
        if (!deptId) continue;

        // Find all supervisors in this department
        const { rows: supervisors } = await db.query(
          "SELECT id FROM users WHERE role = 'SUPERVISOR' AND department_id = $1",
          [deptId]
        );

        for (const sup of supervisors) {
          await db.query(
            `INSERT INTO deputy_supervisor_links (deputy_id, supervisor_id)
             VALUES ($1, $2)
             ON CONFLICT (deputy_id, supervisor_id) DO NOTHING`,
            [deputyUser.id, sup.id]
          );
        }
      }
    }
    console.log('Deputy–Supervisor links ensured.');

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
