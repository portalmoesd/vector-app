const path = require('path');
const config = require('./config');

const fs = require('fs');
const bcrypt = require('bcryptjs');
const db = require('./db');
const logger = require('./logger');
const { resolveHomeDepartmentId } = require('./helpers/home-department');
const { runMigrations } = require('./migrate');

async function getUserId(username) {
  const { rows } = await db.query('SELECT id FROM users WHERE username = $1', [username]);
  return rows.length > 0 ? rows[0].id : null;
}

async function bootstrapDatabase() {
  try {
    logger.info('Running schema migration...');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await db.query(schema);
    logger.info('Schema OK.');

    // Run numbered SQL migrations from server/migrations/
    await runMigrations();

    // One-shot import of legacy server/data/*.json admin uploads into the
    // new admin_uploads table, so no re-upload is needed after the move.
    try {
      const { migrateLegacyDiskUploadsOnce } = require('./routes/admin-uploads');
      await migrateLegacyDiskUploadsOnce();
    } catch (err) {
      logger.warn('admin-uploads legacy migration skipped:', err.message);
    }

    // ── Fix department names to match official org chart (idempotent) ────────
    const deptNameFixes = require('./data/department-name-fixes.json');
    for (const fix of deptNameFixes) {
      await db.query('UPDATE departments SET name = $1, name_en = $2 WHERE name_en = $3', [
        fix.name,
        fix.name_en,
        fix.old_en,
      ]);
    }

    // ── Fix is_external flag: agencies should be external ────────
    const agencyNames = require('./data/agency-names.json');
    await db.query('UPDATE departments SET is_external = false');
    for (const name of agencyNames) {
      await db.query('UPDATE departments SET is_external = true WHERE name_en = $1', [name]);
    }

    // Seed departments if empty
    const {
      rows: [{ count: deptCount }],
    } = await db.query('SELECT count(*)::int AS count FROM departments');
    if (deptCount === 0) {
      logger.info('Seeding departments...');
      const depts = require('./data/departments.json');
      for (const d of depts) {
        await db.query('INSERT INTO departments (name, name_en, is_external) VALUES ($1, $2, $3)', [
          d.name,
          d.name_en,
          d.external,
        ]);
      }
      logger.info(`Seeded ${depts.length} departments.`);
    }

    // Seed countries if empty
    const {
      rows: [{ count: countryCount }],
    } = await db.query('SELECT count(*)::int AS count FROM countries');
    if (countryCount === 0) {
      logger.info('Seeding countries...');
      const countries = require('./data/countries.json');
      for (const c of countries) {
        await db.query('INSERT INTO countries (name_en, code) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING', [
          c.name,
          c.code,
        ]);
      }
      logger.info(`Seeded ${countries.length} countries.`);
    }

    // Seed admin user if not exists
    const {
      rows: [{ count: userCount }],
    } = await db.query('SELECT count(*)::int AS count FROM users');
    const {
      rows: [{ exists: adminExists }],
    } = await db.query("SELECT EXISTS(SELECT 1 FROM users WHERE username='admin') AS exists");
    if (!adminExists && config.allowDefaultSeedUsers) {
      logger.info('Creating default admin user...');
      const hash = await bcrypt.hash('admin123', 10);
      await db.query(
        `INSERT INTO users (full_name, username, email, password_hash, role, must_change_password)
         VALUES ($1, $2, $3, $4, $5, true)`,
        ['System Administrator', 'admin', 'admin@vector-portal.gov.ge', hash, 'ADMIN']
      );
      logger.info('Admin user created (admin / admin123).');
    } else if (!adminExists) {
      logger.warn('No admin user exists. Create an admin through a production-safe provisioning process.');
    }

    // Seed ministry staff if not already seeded
    if (userCount <= 1 && config.allowDefaultSeedUsers) {
      logger.info('Seeding ministry staff...');
      const staffList = require('./data/users.json');
      const defaultHash = await bcrypt.hash('vector2026', 10);

      // Build department name → id lookup
      const { rows: allDepts } = await db.query('SELECT id, name_en FROM departments');
      const deptMap = {};
      for (const d of allDepts) deptMap[d.name_en] = d.id;

      // Get all country IDs for assignment
      const { rows: allCountries } = await db.query('SELECT id FROM countries');
      const countryIds = allCountries.map((c) => c.id);

      for (const s of staffList) {
        const username = s.email
          .split('@')[0]
          .toLowerCase()
          .replace(/[^a-z0-9.]/g, '');
        // Deputies oversee multiple departments via deputy_department_links,
        // so their department_id is left NULL.
        const deptId = s.role === 'DEPUTY' ? null : deptMap[s.dept] || null;

        const {
          rows: [newUser],
        } = await db.query(
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
      logger.info(`Seeded ${staffList.length} staff members.`);
    } else if (userCount <= 1) {
      logger.warn('Default staff seeding skipped in production.');
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
        logger.info(`Updated ${rowCount} Protocol Department user(s) to PROTOCOL role.`);
      }
    }

    // ── Remove incorrectly seeded Deputy users from earlier migration ─────────
    const wrongDeputies = require('./data/wrong-deputies.json');
    for (const uname of wrongDeputies) {
      await db.query("DELETE FROM users WHERE username = $1 AND role = 'DEPUTY'", [uname]);
    }

    // ── Ensure Deputy users exist (idempotent) ────────────────────────────────
    const deputyUsers = require('./data/deputy-users.json');

    // Deputies oversee multiple departments via deputy_department_links,
    // so department_id on the users table is left NULL.
    if (config.allowDefaultSeedUsers) {
      const defaultHashDeputy = await bcrypt.hash('vector2026', 10);
      for (const dep of deputyUsers) {
        const username = dep.email
          .split('@')[0]
          .toLowerCase()
          .replace(/[^a-z0-9.]/g, '');
        await db.query(
          `INSERT INTO users (full_name, username, email, password_hash, role, department_id, must_change_password)
           VALUES ($1, $2, $3, $4, 'DEPUTY', NULL, true)
           ON CONFLICT (username) DO UPDATE SET department_id = NULL`,
          [dep.fullName, username, dep.email, defaultHashDeputy]
        );
      }
    } else {
      logger.warn('Default deputy user provisioning skipped in production.');
    }

    // ── Build department name → id lookup for deputy/template seeding ─────────
    const { rows: allDeptsForDeputy } = await db.query('SELECT id, name_en FROM departments');
    const deptMapForDeputy = {};
    for (const d of allDeptsForDeputy) deptMapForDeputy[d.name_en] = d.id;

    // ── Create Deputy–Supervisor links (idempotent) ───────────────────────────
    // Links define which Deputies/Minister oversee which Supervisors (from org chart)
    const deputySupervisorLinks = require('./data/deputy-supervisor-links.json');

    for (const link of deputySupervisorLinks) {
      const {
        rows: [deputyUser],
      } = await db.query('SELECT id FROM users WHERE username = $1', [link.deputy]);
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
    logger.info('Deputy–Supervisor links ensured.');

    // ── Create Deputy–Department links (direct org chart mapping, idempotent) ──
    for (const link of deputySupervisorLinks) {
      const {
        rows: [deputyUser],
      } = await db.query('SELECT id FROM users WHERE username = $1', [link.deputy]);
      if (!deputyUser) continue;

      for (const deptName of link.supervisorDepts) {
        const deptId = deptMapForDeputy[deptName];
        if (!deptId) continue;
        await db.query(
          `INSERT INTO deputy_department_links (deputy_id, department_id)
           VALUES ($1, $2)
           ON CONFLICT (deputy_id, department_id) DO NOTHING`,
          [deputyUser.id, deptId]
        );
      }
    }
    logger.info('Deputy–Department links ensured.');

    const getDeptId = (nameEn) => deptMapForDeputy[nameEn] || null;

    // ── Seed Event Templates with section-department mappings (idempotent) ────
    const {
      rows: [{ count: templateCount }],
    } = await db.query('SELECT count(*)::int AS count FROM event_templates');
    if (templateCount === 0) {
      logger.info('Seeding event templates...');

      const templateDefs = require('./data/templates.json');

      for (const tpl of templateDefs) {
        const userId = await getUserId(tpl.createdByUsername);
        if (!userId) {
          logger.info(`  Skipping template "${tpl.name}" — user ${tpl.createdByUsername} not found`);
          continue;
        }

        const {
          rows: [template],
        } = await db.query(
          `INSERT INTO event_templates (name, created_by_id, document_submitter_role, curator_required, is_default)
           VALUES ($1, $2, $3, $4, false)
           RETURNING id`,
          [tpl.name, userId, tpl.dsRole, tpl.curatorRequired]
        );

        for (let i = 0; i < tpl.sections.length; i++) {
          const sec = tpl.sections[i];
          const {
            rows: [tplSection],
          } = await db.query(
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
              logger.info(`  Warning: department "${deptName}" not found for template section "${sec.title}"`);
            }
          }
        }

        logger.info(`  Created template: ${tpl.name} (${tpl.sections.length} sections)`);
      }

      // Create the Default Template — visible to all users, combines all sections
      const defaultSections = require('./data/default-template-sections.json');

      const {
        rows: [defaultTpl],
      } = await db.query(
        `INSERT INTO event_templates (name, created_by_id, document_submitter_role, curator_required, is_default)
         VALUES ('Default Template', NULL, 'DEPUTY', false, true)
         RETURNING id`
      );

      for (let i = 0; i < defaultSections.length; i++) {
        const sec = defaultSections[i];
        const {
          rows: [tplSection],
        } = await db.query(
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
      logger.info(`  Created Default Template (${defaultSections.length} sections)`);

      logger.info('Event templates seeded.');
    }

    // ── Ensure Default Template exists (idempotent, runs even if other templates exist) ──
    const {
      rows: [{ exists: defaultExists }],
    } = await db.query('SELECT EXISTS(SELECT 1 FROM event_templates WHERE is_default = true) AS exists');
    if (!defaultExists) {
      logger.info('Creating Default Template...');
      const { rows: allDeptsLookup } = await db.query('SELECT id, name_en FROM departments');
      const deptLookup = {};
      for (const d of allDeptsLookup) deptLookup[d.name_en] = d.id;

      const defaultSections = require('./data/default-template-sections.json');

      const {
        rows: [defaultTpl],
      } = await db.query(
        `INSERT INTO event_templates (name, created_by_id, document_submitter_role, curator_required, is_default)
         VALUES ('Default Template', NULL, 'DEPUTY', false, true)
         RETURNING id`
      );

      for (let i = 0; i < defaultSections.length; i++) {
        const sec = defaultSections[i];
        const {
          rows: [tplSection],
        } = await db.query(
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
      logger.info(`Default Template created (${defaultSections.length} sections).`);
    }

    // ── Fix stuck mid-chain approved_by_ statuses ────────────────────────────
    // A previous bug set approved_by_<role> for mid-chain approvals instead of
    // submitted_to_<nextRole>. Fix any sections still stuck in that state.
    const { buildChain, nextInChain, isFinalApprover, submittedToStatus: subToStatus } = require('./helpers/pipeline');
    const { rows: stuckSections } = await db.query(
      `SELECT sc.event_id, sc.section_id, sc.status,
              e.document_submitter_role, e.curator_required, e.supervisor_id, e.document_submitter_id
       FROM section_content sc
       JOIN events e ON e.id = sc.event_id
       WHERE sc.status LIKE 'approved_by_%'`
    );
    for (const row of stuckSections) {
      const approverRole = row.status.replace('approved_by_', '').toUpperCase();

      const dsDeptId = await resolveHomeDepartmentId(row);
      const { rows: sdRows } = await db.query('SELECT department_id FROM section_departments WHERE section_id = $1', [
        row.section_id,
      ]);
      const isCrossDept = sdRows.some((d) => d.department_id !== dsDeptId);

      const chain = buildChain(row.document_submitter_role, row.curator_required, isCrossDept);

      // Only fix mid-chain approvals (not final approvals)
      if (!isFinalApprover(approverRole, chain)) {
        const nextRole = nextInChain(approverRole, chain);
        if (nextRole) {
          const newStatus = subToStatus(nextRole);
          await db.query('UPDATE section_content SET status = $1 WHERE event_id = $2 AND section_id = $3', [
            newStatus,
            row.event_id,
            row.section_id,
          ]);
          logger.info(
            `Fixed stuck section: event=${row.event_id} section=${row.section_id} ${row.status} → ${newStatus}`
          );
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Migration error');
    throw err;
  }
}

module.exports = { bootstrapDatabase };
