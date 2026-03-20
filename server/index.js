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

    // Add is_default column if missing (migration for existing databases)
    await db.query(`
      DO $$ BEGIN
        ALTER TABLE event_templates ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
    `);

    // Make created_by_id nullable (for system Default Template)
    await db.query(`
      ALTER TABLE event_templates ALTER COLUMN created_by_id DROP NOT NULL;
    `);

    // Add supervisor_id column to events if missing
    await db.query(`
      DO $$ BEGIN
        ALTER TABLE events ADD COLUMN IF NOT EXISTS supervisor_id INT REFERENCES users(id);
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
    `);

    // ── Fix department names to match official org chart (idempotent) ────────
    const deptNameFixes = [
      { old_en: 'Protocol Service', name: 'პროტოკოლის სამსახური', name_en: 'Protocol Department' },
      { old_en: 'Transport Safety Investigation Bureau', name: 'სატრანსპორტო უსაფრთხოების მოკვლევის ბიურო', name_en: 'Transportation Safety Investigation Bureau' },
      { old_en: 'Strategic Communications Department', name: 'სტრატეგიული კომუნიკაციის დეპარტამენტი', name_en: 'Department of Strategic Communication' },
      { old_en: 'Capital Market Development and Pension Reform Department', name: 'კაპიტალის ბაზრის განვითარებისა და საპენსიო რეფორმის დეპარტამენტი', name_en: 'Capital Market Development and Pension Reform Department' },
      { old_en: 'Investment Policy and Support Department', name: 'საინვესტიციო პოლიტიკისა და ინვესტიციების მხარდაჭერის დეპარტამენტი', name_en: 'Investment Policy and Support Department' },
      { old_en: 'Unified National Accreditation Body - Accreditation Center', name: 'აკრედიტაციის ერთიანი ეროვნული ორგანო', name_en: 'The Unified National Body of Accreditation' },
      { old_en: 'Georgian National Agency for Standards and Metrology', name: 'საქართველოს სტანდარტებისა და მეტროლოგიის ეროვნული სააგენტო', name_en: 'Georgian National Agency for Standarts and Metrology' },
    ];
    for (const fix of deptNameFixes) {
      await db.query(
        'UPDATE departments SET name = $1, name_en = $2 WHERE name_en = $3',
        [fix.name, fix.name_en, fix.old_en]
      );
    }

    // ── Fix is_external flag: agencies should be external ────────
    const agencyNames = [
      'Transportation Safety Investigation Bureau',
      'National Agency of State Property',
      'Spatial and Urban Development Agency',
      'Georgian National Agency for Standarts and Metrology',
      'The Unified National Body of Accreditation',
      'Technical and Constructions Supervision Agency',
      'Market Surveillance Agency',
      'State Agency of Oil and Gas',
      'Land Transport Agency',
      'Maritime Transport Agency',
      'Civil Aviation Agency',
      'Anaklia Deep Sea Port Development Agency',
      'Rail Transport Agency',
      "Georgia's Innovation and Technology Agency",
      'Enterprise Georgia',
      'Georgian National Tourism Administration',
    ];
    await db.query('UPDATE departments SET is_external = false');
    for (const name of agencyNames) {
      await db.query('UPDATE departments SET is_external = true WHERE name_en = $1', [name]);
    }

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
      "SELECT id FROM departments WHERE name_en IN ('Protocol Service', 'Protocol Department') LIMIT 1"
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
      { fullName: 'Mariam Kvrivishvili', email: 'mkvrivishvili@moesd.gov.ge', dept: 'Internal Audit Department' },
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
    // Links define which Deputies/Minister oversee which Supervisors (from org chart)
    const deputySupervisorLinks = [
      // Minister Mariam Kvrivishvili
      { deputy: 'mkvrivishvili', supervisorDepts: [
        'Internal Audit Department',
        'Human Resources Management Department',
        'Department of Strategic Communication',
        'Protocol Department',
        'Transportation Safety Investigation Bureau',
      ]},
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
        'Georgian National Agency for Standarts and Metrology',
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
      // Deputy Vakhtang Tsintsadze: Economic Analysis, Economic Policy, Administrative, Strategic Development
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

    // ── Seed Event Templates with section-department mappings (idempotent) ────
    const { rows: [{ count: templateCount }] } = await db.query('SELECT count(*)::int AS count FROM event_templates');
    if (templateCount === 0) {
      console.log('Seeding event templates...');

      // Helper: get user id by username
      async function getUserId(username) {
        const { rows } = await db.query('SELECT id FROM users WHERE username = $1', [username]);
        return rows.length > 0 ? rows[0].id : null;
      }

      // Helper: get dept id by name_en
      function getDeptId(nameEn) {
        return deptMapForDeputy[nameEn] || null;
      }

      const templateDefs = [
        // Nino Enukidze — separate per-department sections
        {
          name: 'Nino Enukidze — Standard',
          createdByUsername: 'nenukidze',
          dsRole: 'DEPUTY',
          curatorRequired: false,
          sections: [
            { title: 'Legal', depts: ['Legal Department'] },
            { title: 'State Property', depts: ['National Agency of State Property'] },
            { title: 'Spatial & Urban Development', depts: ['Spatial and Urban Development Agency'] },
          ],
        },
        // Genadi Arveladze
        {
          name: 'Genadi Arveladze — Standard',
          createdByUsername: 'garveladze',
          dsRole: 'DEPUTY',
          curatorRequired: false,
          sections: [
            { title: 'Foreign Trade Policy', depts: ['Foreign Trade Policy Department'] },
            { title: 'Foreign Trade & Economic Relations', depts: ['Department of Trade Development and International Economic Relations'] },
            { title: 'Construction', depts: ['Construction Policy Department', 'Technical and Constructions Supervision Agency'] },
            { title: 'Market Surveillance', depts: ['Georgian National Agency for Standarts and Metrology', 'The Unified National Body of Accreditation', 'Market Surveillance Agency'] },
          ],
        },
        // Inga Pkhaladze
        {
          name: 'Inga Pkhaladze — Standard',
          createdByUsername: 'ipkhaladze',
          dsRole: 'DEPUTY',
          curatorRequired: false,
          sections: [
            { title: 'Energy', depts: ['Energy Reforms Department', 'Energy Efficiency and Renewable Energy Policy and Sustainable Development Department', 'Energy Policy and Investment Projects Department', 'Department of Energy Enterprises Management', 'State Agency of Oil and Gas'] },
          ],
        },
        // Tamar Ioseliani
        {
          name: 'Tamar Ioseliani — Standard',
          createdByUsername: 'tioseliani',
          dsRole: 'DEPUTY',
          curatorRequired: false,
          sections: [
            { title: 'Transport', depts: ['Transport and Logistics Development Policy Department', 'Road Safety Department', 'Land Transport Agency', 'Maritime Transport Agency', 'Civil Aviation Agency', 'Anaklia Deep Sea Port Development Agency', 'Rail Transport Agency'] },
            { title: 'Communications, Information Technology and Post', depts: ['Communications, Information and Modern Technologies Department'] },
          ],
        },
        // Vakhtang Tsintsadze
        {
          name: 'Vakhtang Tsintsadze — Standard',
          createdByUsername: 'vtsitsadze',
          dsRole: 'DEPUTY',
          curatorRequired: false,
          sections: [
            { title: 'Economic Analysis, Policy & Reforms', depts: ['Economic Analysis and Reforms Department', 'Economic Policy Department'] },
            { title: 'Administration', depts: ['Administrative Department', 'Strategic Development Department'] },
          ],
        },
        // Irakli Nadareishvili
        {
          name: 'Irakli Nadareishvili — Standard',
          createdByUsername: 'inadareishvili',
          dsRole: 'DEPUTY',
          curatorRequired: false,
          sections: [
            { title: 'Capital Markets', depts: ['Capital Market Development and Pension Reform Department'] },
            { title: 'Investments', depts: ['Investment Policy and Support Department'] },
            { title: 'Tourism', depts: ['Georgian National Tourism Administration'] },
            { title: 'Innovation', depts: ["Georgia's Innovation and Technology Agency", 'Enterprise Georgia'] },
          ],
        },
      ];

      for (const tpl of templateDefs) {
        const userId = await getUserId(tpl.createdByUsername);
        if (!userId) {
          console.log(`  Skipping template "${tpl.name}" — user ${tpl.createdByUsername} not found`);
          continue;
        }

        const { rows: [template] } = await db.query(
          `INSERT INTO event_templates (name, created_by_id, document_submitter_role, curator_required, is_default)
           VALUES ($1, $2, $3, $4, false)
           RETURNING id`,
          [tpl.name, userId, tpl.dsRole, tpl.curatorRequired]
        );

        for (let i = 0; i < tpl.sections.length; i++) {
          const sec = tpl.sections[i];
          const { rows: [tplSection] } = await db.query(
            'INSERT INTO event_template_sections (template_id, title, sort_order) VALUES ($1, $2, $3) RETURNING id',
            [template.id, sec.title, i]
          );

          for (const deptName of sec.depts) {
            const deptId = getDeptId(deptName);
            if (deptId) {
              await db.query(
                'INSERT INTO event_template_section_departments (template_section_id, department_id) VALUES ($1, $2)',
                [tplSection.id, deptId]
              );
            } else {
              console.log(`  Warning: department "${deptName}" not found for template section "${sec.title}"`);
            }
          }
        }

        console.log(`  Created template: ${tpl.name} (${tpl.sections.length} sections)`);
      }

      // Create the Default Template — visible to all users, combines all sections
      const defaultSections = [
        { title: 'Legal', depts: ['Legal Department'] },
        { title: 'State Property', depts: ['National Agency of State Property'] },
        { title: 'Spatial & Urban Development', depts: ['Spatial and Urban Development Agency'] },
        { title: 'Foreign Trade Policy', depts: ['Foreign Trade Policy Department'] },
        { title: 'Foreign Trade & Economic Relations', depts: ['Department of Trade Development and International Economic Relations'] },
        { title: 'Construction', depts: ['Construction Policy Department', 'Technical and Constructions Supervision Agency'] },
        { title: 'Market Surveillance', depts: ['Georgian National Agency for Standarts and Metrology', 'The Unified National Body of Accreditation', 'Market Surveillance Agency'] },
        { title: 'Energy', depts: ['Energy Reforms Department', 'Energy Efficiency and Renewable Energy Policy and Sustainable Development Department', 'Energy Policy and Investment Projects Department', 'Department of Energy Enterprises Management', 'State Agency of Oil and Gas'] },
        { title: 'Transport', depts: ['Transport and Logistics Development Policy Department', 'Road Safety Department', 'Land Transport Agency', 'Maritime Transport Agency', 'Civil Aviation Agency', 'Anaklia Deep Sea Port Development Agency', 'Rail Transport Agency'] },
        { title: 'Communications, Information Technology and Post', depts: ['Communications, Information and Modern Technologies Department'] },
        { title: 'Economic Analysis, Policy & Reforms', depts: ['Economic Analysis and Reforms Department', 'Economic Policy Department'] },
        { title: 'Administration', depts: ['Administrative Department', 'Strategic Development Department'] },
        { title: 'Capital Markets', depts: ['Capital Market Development and Pension Reform Department'] },
        { title: 'Investments', depts: ['Investment Policy and Support Department'] },
        { title: 'Tourism', depts: ['Georgian National Tourism Administration'] },
        { title: 'Innovation', depts: ["Georgia's Innovation and Technology Agency", 'Enterprise Georgia'] },
      ];

      const { rows: [defaultTpl] } = await db.query(
        `INSERT INTO event_templates (name, created_by_id, document_submitter_role, curator_required, is_default)
         VALUES ('Default Template', NULL, 'DEPUTY', false, true)
         RETURNING id`
      );

      for (let i = 0; i < defaultSections.length; i++) {
        const sec = defaultSections[i];
        const { rows: [tplSection] } = await db.query(
          'INSERT INTO event_template_sections (template_id, title, sort_order) VALUES ($1, $2, $3) RETURNING id',
          [defaultTpl.id, sec.title, i]
        );
        for (const deptName of sec.depts) {
          const deptId = getDeptId(deptName);
          if (deptId) {
            await db.query(
              'INSERT INTO event_template_section_departments (template_section_id, department_id) VALUES ($1, $2)',
              [tplSection.id, deptId]
            );
          }
        }
      }
      console.log(`  Created Default Template (${defaultSections.length} sections)`);

      console.log('Event templates seeded.');
    }

    // ── Ensure Default Template exists (idempotent, runs even if other templates exist) ──
    const { rows: [{ exists: defaultExists }] } = await db.query(
      "SELECT EXISTS(SELECT 1 FROM event_templates WHERE is_default = true) AS exists"
    );
    if (!defaultExists) {
      console.log('Creating Default Template...');
      const { rows: allDeptsLookup } = await db.query('SELECT id, name_en FROM departments');
      const deptLookup = {};
      for (const d of allDeptsLookup) deptLookup[d.name_en] = d.id;

      const defaultSections = [
        { title: 'Legal', depts: ['Legal Department'] },
        { title: 'State Property', depts: ['National Agency of State Property'] },
        { title: 'Spatial & Urban Development', depts: ['Spatial and Urban Development Agency'] },
        { title: 'Foreign Trade Policy', depts: ['Foreign Trade Policy Department'] },
        { title: 'Foreign Trade & Economic Relations', depts: ['Department of Trade Development and International Economic Relations'] },
        { title: 'Construction', depts: ['Construction Policy Department', 'Technical and Constructions Supervision Agency'] },
        { title: 'Market Surveillance', depts: ['Georgian National Agency for Standarts and Metrology', 'The Unified National Body of Accreditation', 'Market Surveillance Agency'] },
        { title: 'Energy', depts: ['Energy Reforms Department', 'Energy Efficiency and Renewable Energy Policy and Sustainable Development Department', 'Energy Policy and Investment Projects Department', 'Department of Energy Enterprises Management', 'State Agency of Oil and Gas'] },
        { title: 'Transport', depts: ['Transport and Logistics Development Policy Department', 'Road Safety Department', 'Land Transport Agency', 'Maritime Transport Agency', 'Civil Aviation Agency', 'Anaklia Deep Sea Port Development Agency', 'Rail Transport Agency'] },
        { title: 'Communications, Information Technology and Post', depts: ['Communications, Information and Modern Technologies Department'] },
        { title: 'Economic Analysis, Policy & Reforms', depts: ['Economic Analysis and Reforms Department', 'Economic Policy Department'] },
        { title: 'Administration', depts: ['Administrative Department', 'Strategic Development Department'] },
        { title: 'Capital Markets', depts: ['Capital Market Development and Pension Reform Department'] },
        { title: 'Investments', depts: ['Investment Policy and Support Department'] },
        { title: 'Tourism', depts: ['Georgian National Tourism Administration'] },
        { title: 'Innovation', depts: ["Georgia's Innovation and Technology Agency", 'Enterprise Georgia'] },
      ];

      const { rows: [defaultTpl] } = await db.query(
        `INSERT INTO event_templates (name, created_by_id, document_submitter_role, curator_required, is_default)
         VALUES ('Default Template', NULL, 'DEPUTY', false, true)
         RETURNING id`
      );

      for (let i = 0; i < defaultSections.length; i++) {
        const sec = defaultSections[i];
        const { rows: [tplSection] } = await db.query(
          'INSERT INTO event_template_sections (template_id, title, sort_order) VALUES ($1, $2, $3) RETURNING id',
          [defaultTpl.id, sec.title, i]
        );
        for (const deptName of sec.depts) {
          const deptId = deptLookup[deptName];
          if (deptId) {
            await db.query(
              'INSERT INTO event_template_section_departments (template_section_id, department_id) VALUES ($1, $2)',
              [tplSection.id, deptId]
            );
          }
        }
      }
      console.log(`Default Template created (${defaultSections.length} sections).`);
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
