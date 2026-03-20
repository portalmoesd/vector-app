const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { ROLES } = require('../helpers/roles');
const {
  STATUS,
  baseRole,
  buildChain,
  nextInChain,
  isFinalApprover,
  firstEditorRole,
  submittedToStatus,
  approvedByStatus,
  returnedByStatus,
  currentHolderRole,
} = require('../helpers/pipeline');

const router = express.Router();

// ─── Helper: load section context ─────────────────────────────────────────────

async function loadSectionContext(eventId, sectionId) {
  const { rows: [event] } = await db.query(
    `SELECT id, document_submitter_role, document_submitter_id, deputy_id,
            curator_required, country_id, status AS event_status
     FROM events WHERE id = $1`,
    [eventId]
  );
  if (!event) return null;

  const { rows: [sc] } = await db.query(
    `SELECT status, original_submitter_role, return_target_role
     FROM section_content WHERE event_id = $1 AND section_id = $2`,
    [eventId, sectionId]
  );
  if (!sc) return null;

  // Determine if section has cross-department assignments
  const { rows: [dsUser] } = await db.query(
    'SELECT department_id FROM users WHERE id = $1', [event.document_submitter_id]
  );
  const { rows: deptRows } = await db.query(
    'SELECT department_id FROM section_departments WHERE section_id = $1', [sectionId]
  );
  const sectionDeptIds = deptRows.map(r => r.department_id);
  const dsDeptId = dsUser ? dsUser.department_id : null;
  const isCrossDept = sectionDeptIds.some(d => d !== dsDeptId);

  const chain = buildChain(event.document_submitter_role, event.curator_required, isCrossDept);

  return {
    event,
    sectionStatus: sc.status || 'draft',
    originalSubmitterRole: sc.original_submitter_role,
    returnTargetRole: sc.return_target_role,
    chain,
    isCrossDept,
    dsDeptId,
    sectionDeptIds,
  };
}

/**
 * Map user role to the effective pipeline step label for a given section.
 *
 * - A Deputy who oversees the section's department and is NOT the DS → CURATOR
 * - A user in the DS's home dept whose RECEIVING_ variant exists in the chain
 *   → RECEIVING_SUPER_COLLABORATOR or RECEIVING_SUPERVISOR
 * - Otherwise → the user's base role
 */
async function effectiveRole(user, event, sectionDeptIds, chain) {
  // Deputy as Curator
  if (user.role === ROLES.DEPUTY && event.document_submitter_id !== user.id && sectionDeptIds) {
    const { rows } = await db.query(
      `SELECT 1 FROM deputy_department_links
       WHERE deputy_id = $1 AND department_id = ANY($2) LIMIT 1`,
      [user.id, sectionDeptIds]
    );
    if (rows.length > 0) return 'CURATOR';
  }

  // Check if user belongs to the receiving chain (DS's home department)
  if (chain) {
    const receivingLabel = 'RECEIVING_' + user.role;
    if (chain.includes(receivingLabel)) {
      // User's dept must match DS's home dept to be in the receiving chain
      const { rows: [dsUser] } = await db.query(
        'SELECT department_id FROM users WHERE id = $1', [event.document_submitter_id]
      );
      if (dsUser && user.department_id === dsUser.department_id) {
        return receivingLabel;
      }
    }
  }

  return user.role;
}

// ─── POST /api/workflow/save ──────────────────────────────────────────────────

router.post('/save', requireAuth, async (req, res) => {
  try {
    const { eventId, sectionId, htmlContent } = req.body;
    if (!eventId || !sectionId) {
      return res.status(400).json({ error: 'eventId and sectionId are required' });
    }

    await db.query(
      `UPDATE section_content
       SET html_content = $1,
           last_updated_by_user_id = $2,
           last_updated_at = now(),
           last_content_edited_at = now(),
           last_content_edited_by_user_id = $2
       WHERE event_id = $3 AND section_id = $4`,
      [htmlContent || '', req.user.id, eventId, sectionId]
    );

    // Record in history
    await db.query(
      `INSERT INTO section_history (event_id, section_id, action, from_status, to_status, user_id, user_name, user_role)
       SELECT $1, $2, 'saved', sc.status, sc.status, $3, u.full_name, $4
       FROM section_content sc, users u
       WHERE sc.event_id = $1 AND sc.section_id = $2 AND u.id = $3`,
      [eventId, sectionId, req.user.id, req.user.role]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Save error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/workflow/submit ────────────────────────────────────────────────

router.post('/submit', requireAuth, async (req, res) => {
  try {
    const { eventId, sectionId } = req.body;
    if (!eventId || !sectionId) {
      return res.status(400).json({ error: 'eventId and sectionId are required' });
    }

    const ctx = await loadSectionContext(eventId, sectionId);
    if (!ctx) return res.status(404).json({ error: 'Section not found' });

    const userRole = await effectiveRole(req.user, ctx.event, ctx.sectionDeptIds, ctx.chain);
    const holder = currentHolderRole(ctx.sectionStatus, ctx.originalSubmitterRole, ctx.returnTargetRole, ctx.chain);

    // Verify user is the current holder
    if (userRole !== holder) {
      return res.status(403).json({
        error: `Section is held by ${holder}, not ${userRole}`,
      });
    }

    // Find the next role in the chain
    const nextRole = nextInChain(userRole, ctx.chain);
    if (!nextRole) {
      return res.status(400).json({ error: 'No next step in chain — use approve if you are the final approver' });
    }

    const fromStatus = ctx.sectionStatus;
    const toStatus = submittedToStatus(nextRole);

    // Set original_submitter_role on first submit from draft
    const origRole = ctx.originalSubmitterRole || userRole;

    await db.query(
      `UPDATE section_content
       SET status = $1, original_submitter_role = $2,
           last_updated_by_user_id = $3, last_updated_at = now(),
           status_comment = NULL, return_target_role = NULL
       WHERE event_id = $4 AND section_id = $5`,
      [toStatus, origRole, req.user.id, eventId, sectionId]
    );

    // Update event to IN_PROGRESS if still DRAFT
    if (ctx.event.event_status === 'DRAFT') {
      await db.query("UPDATE events SET status = 'IN_PROGRESS', updated_at = now() WHERE id = $1", [eventId]);
    }

    // Record history
    await db.query(
      `INSERT INTO section_history (event_id, section_id, action, from_status, to_status, user_id, user_name, user_role)
       VALUES ($1, $2, 'submitted', $3, $4, $5, $6, $7)`,
      [eventId, sectionId, fromStatus, toStatus, req.user.id, req.user.fullName || req.user.full_name, userRole]
    );

    // Clear any pending return requests for this section
    await db.query(
      'DELETE FROM section_return_requests WHERE event_id = $1 AND section_id = $2',
      [eventId, sectionId]
    );

    res.json({ success: true, newStatus: toStatus });
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/workflow/approve ───────────────────────────────────────────────

router.post('/approve', requireAuth, async (req, res) => {
  try {
    const { eventId, sectionId, comment } = req.body;
    if (!eventId || !sectionId) {
      return res.status(400).json({ error: 'eventId and sectionId are required' });
    }

    const ctx = await loadSectionContext(eventId, sectionId);
    if (!ctx) return res.status(404).json({ error: 'Section not found' });

    const userRole = await effectiveRole(req.user, ctx.event, ctx.sectionDeptIds, ctx.chain);
    const holder = currentHolderRole(ctx.sectionStatus, ctx.originalSubmitterRole, ctx.returnTargetRole, ctx.chain);

    // Must be submitted to this role
    if (userRole !== holder) {
      return res.status(403).json({
        error: `Section is held by ${holder}, not ${userRole}`,
      });
    }

    // Status must be "submitted_to_<role>"
    const expectedStatus = submittedToStatus(userRole);
    if (ctx.sectionStatus !== expectedStatus) {
      return res.status(400).json({
        error: `Cannot approve — section status is ${ctx.sectionStatus}, expected ${expectedStatus}`,
      });
    }

    const fromStatus = ctx.sectionStatus;
    let toStatus;

    if (isFinalApprover(userRole, ctx.chain)) {
      // Final approval — mark as approved by DS
      toStatus = approvedByStatus(userRole);
    } else {
      // Mid-chain approval — approved by this role
      toStatus = approvedByStatus(userRole);
    }

    await db.query(
      `UPDATE section_content
       SET status = $1, status_comment = $2,
           last_updated_by_user_id = $3, last_updated_at = now(),
           return_target_role = NULL
       WHERE event_id = $4 AND section_id = $5`,
      [toStatus, comment || null, req.user.id, eventId, sectionId]
    );

    // Record history
    await db.query(
      `INSERT INTO section_history (event_id, section_id, action, from_status, to_status, user_id, user_name, user_role, note)
       VALUES ($1, $2, 'approved', $3, $4, $5, $6, $7, $8)`,
      [eventId, sectionId, fromStatus, toStatus, req.user.id,
       req.user.fullName || req.user.full_name, userRole, comment || null]
    );

    // Clear any pending return requests
    await db.query(
      'DELETE FROM section_return_requests WHERE event_id = $1 AND section_id = $2',
      [eventId, sectionId]
    );

    // If this was the final approval, check if all sections are approved → complete event
    if (isFinalApprover(userRole, ctx.chain)) {
      await checkEventCompletion(eventId);
    }

    res.json({ success: true, newStatus: toStatus });
  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/workflow/return ────────────────────────────────────────────────

router.post('/return', requireAuth, async (req, res) => {
  try {
    const { eventId, sectionId, comment } = req.body;
    if (!eventId || !sectionId) {
      return res.status(400).json({ error: 'eventId and sectionId are required' });
    }

    const ctx = await loadSectionContext(eventId, sectionId);
    if (!ctx) return res.status(404).json({ error: 'Section not found' });

    const userRole = await effectiveRole(req.user, ctx.event, ctx.sectionDeptIds, ctx.chain);
    const holder = currentHolderRole(ctx.sectionStatus, ctx.originalSubmitterRole, ctx.returnTargetRole, ctx.chain);

    if (userRole !== holder) {
      return res.status(403).json({
        error: `Section is held by ${holder}, not ${userRole}`,
      });
    }

    // Section must be submitted_to this role
    const expectedStatus = submittedToStatus(userRole);
    if (ctx.sectionStatus !== expectedStatus) {
      return res.status(400).json({
        error: `Cannot return — section status is ${ctx.sectionStatus}, expected ${expectedStatus}`,
      });
    }

    const fromStatus = ctx.sectionStatus;
    const toStatus = returnedByStatus(userRole);

    // Return goes back to the original editor level (§5.2 rule 6)
    const returnTarget = firstEditorRole(ctx.chain);

    await db.query(
      `UPDATE section_content
       SET status = $1, status_comment = $2,
           return_target_role = $3,
           last_updated_by_user_id = $4, last_updated_at = now()
       WHERE event_id = $5 AND section_id = $6`,
      [toStatus, comment || null, returnTarget, req.user.id, eventId, sectionId]
    );

    // Record history
    await db.query(
      `INSERT INTO section_history (event_id, section_id, action, from_status, to_status, user_id, user_name, user_role, note)
       VALUES ($1, $2, 'returned', $3, $4, $5, $6, $7, $8)`,
      [eventId, sectionId, fromStatus, toStatus, req.user.id,
       req.user.fullName || req.user.full_name, userRole, comment || null]
    );

    res.json({ success: true, newStatus: toStatus, returnTargetRole: returnTarget });
  } catch (err) {
    console.error('Return error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/workflow/ask-to-return ─────────────────────────────────────────

router.post('/ask-to-return', requireAuth, async (req, res) => {
  try {
    const { eventId, sectionId, note } = req.body;
    if (!eventId || !sectionId) {
      return res.status(400).json({ error: 'eventId and sectionId are required' });
    }

    const ctx = await loadSectionContext(eventId, sectionId);
    if (!ctx) return res.status(404).json({ error: 'Section not found' });

    const userRole = await effectiveRole(req.user, ctx.event, ctx.sectionDeptIds, ctx.chain);

    // The section must NOT be at the requester's stage (they can't ask-to-return their own stage)
    const holder = currentHolderRole(ctx.sectionStatus, ctx.originalSubmitterRole, ctx.returnTargetRole, ctx.chain);
    if (userRole === holder) {
      return res.status(400).json({ error: 'You currently hold this section — use return instead' });
    }

    // Broadcast upward to all roles above requester in the chain
    await db.query(
      `INSERT INTO section_return_requests
       (event_id, section_id, requested_by_user_id, requested_by_name, requested_by_role, broadcast_above_role, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [eventId, sectionId, req.user.id,
       req.user.fullName || req.user.full_name,
       userRole, userRole, note || null]
    );

    // Record history
    await db.query(
      `INSERT INTO section_history (event_id, section_id, action, from_status, to_status, user_id, user_name, user_role, note)
       VALUES ($1, $2, 'asked_to_return', $3, $3, $4, $5, $6, $7)`,
      [eventId, sectionId, ctx.sectionStatus, req.user.id,
       req.user.fullName || req.user.full_name, userRole, note || null]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Ask-to-return error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/workflow/return-requests ─────────────────────────────────────────

router.get('/return-requests', requireAuth, async (req, res) => {
  try {
    const { event_id, section_id } = req.query;
    if (!event_id) return res.status(400).json({ error: 'event_id is required' });

    let query = `SELECT id, event_id, section_id, requested_by_user_id,
                        requested_by_name, requested_by_role, broadcast_above_role,
                        note, created_at
                 FROM section_return_requests WHERE event_id = $1`;
    const params = [event_id];

    if (section_id) {
      query += ' AND section_id = $2';
      params.push(section_id);
    }
    query += ' ORDER BY created_at DESC';

    const { rows } = await db.query(query, params);
    res.json(rows.map(r => ({
      id: r.id,
      eventId: r.event_id,
      sectionId: r.section_id,
      requestedByUserId: r.requested_by_user_id,
      requestedByName: r.requested_by_name,
      requestedByRole: r.requested_by_role,
      broadcastAboveRole: r.broadcast_above_role,
      note: r.note,
      createdAt: r.created_at,
    })));
  } catch (err) {
    console.error('Return requests error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/workflow/send-to-library ───────────────────────────────────────

router.post('/send-to-library', requireAuth, async (req, res) => {
  try {
    const { eventId } = req.body;
    if (!eventId) return res.status(400).json({ error: 'eventId is required' });

    // Verify user is the Document Submitter
    const { rows: [event] } = await db.query(
      'SELECT document_submitter_id, status FROM events WHERE id = $1', [eventId]
    );
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.document_submitter_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the Document Submitter can send to library' });
    }

    // Verify all sections are fully approved
    const { rows: sections } = await db.query(
      `SELECT sc.status FROM section_content sc WHERE sc.event_id = $1`, [eventId]
    );

    const allApproved = sections.every(s => s.status.startsWith('approved_by_'));
    if (!allApproved) {
      return res.status(400).json({ error: 'All sections must be approved before sending to library' });
    }

    await db.query(
      "UPDATE events SET status = 'COMPLETED', updated_at = now() WHERE id = $1",
      [eventId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Send to library error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/workflow/status-grid ────────────────────────────────────────────

router.get('/status-grid', requireAuth, async (req, res) => {
  try {
    const eventId = req.query.event_id;
    if (!eventId) return res.status(400).json({ error: 'event_id is required' });

    const { rows: [event] } = await db.query(
      `SELECT id, document_submitter_role, document_submitter_id,
              deputy_id, curator_required
       FROM events WHERE id = $1`,
      [eventId]
    );
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Get DS department
    const { rows: [dsUser] } = await db.query(
      'SELECT department_id FROM users WHERE id = $1', [event.document_submitter_id]
    );
    const dsDeptId = dsUser ? dsUser.department_id : null;

    const { rows: sections } = await db.query(
      `SELECT s.id AS section_id, s.title AS section_label,
              sc.status, sc.status_comment, sc.last_updated_at,
              sc.original_submitter_role, sc.return_target_role,
              u.full_name AS last_updated_by,
              sc.last_content_edited_by_user_id
       FROM sections s
       LEFT JOIN section_content sc ON sc.section_id = s.id AND sc.event_id = s.event_id
       LEFT JOIN users u ON u.id = sc.last_updated_by_user_id
       WHERE s.event_id = $1
       ORDER BY s.sort_order`,
      [eventId]
    );

    // Get department assignments and actor names for each section
    const enrichedSections = [];
    for (const s of sections) {
      const { rows: deptRows } = await db.query(
        `SELECT sd.department_id, d.name_en AS department_name
         FROM section_departments sd
         LEFT JOIN departments d ON d.id = sd.department_id
         WHERE sd.section_id = $1`,
        [s.section_id]
      );
      const sectionDeptIds = deptRows.map(r => r.department_id);
      const sectionDeptNames = deptRows.map(r => r.department_name).filter(Boolean);
      const isCrossDept = sectionDeptIds.some(d => d !== dsDeptId);
      const chain = buildChain(event.document_submitter_role, event.curator_required, isCrossDept);

      // Resolve actor names for each step in the chain
      const steps = [];
      for (const step of chain) {
        let actorName = null;
        let actorId = null;
        let deptName = null;

        if (step === 'CURATOR') {
          // Find the deputy who oversees the section's department(s), excluding the DS
          const { rows: [dep] } = await db.query(
            `SELECT u.id, u.full_name, d.name_en AS department_name
             FROM deputy_department_links ddl
             JOIN users u ON u.id = ddl.deputy_id
             LEFT JOIN departments d ON d.id = u.department_id
             WHERE ddl.department_id = ANY($1) AND u.id != $2
             ORDER BY u.id LIMIT 1`,
            [sectionDeptIds, event.document_submitter_id]);
          if (dep) { actorName = dep.full_name; actorId = dep.id; deptName = dep.department_name; }
        } else if (step === ROLES.DEPUTY && event.document_submitter_role === 'DEPUTY') {
          // Deputy step = the Document Submitter themselves
          const { rows: [dep] } = await db.query(
            `SELECT u.id, u.full_name, d.name_en AS department_name
             FROM users u LEFT JOIN departments d ON d.id = u.department_id
             WHERE u.id = $1`, [event.document_submitter_id]);
          if (dep) { actorName = dep.full_name; actorId = dep.id; deptName = dep.department_name; }
        } else if (step.startsWith('RECEIVING_')) {
          // Receiving chain: search in DS's home department using the base role
          const dbRole = baseRole(step);
          if (dsDeptId) {
            const { rows: [user] } = await db.query(
              `SELECT u.id, u.full_name, d.name_en AS department_name
               FROM users u
               LEFT JOIN departments d ON d.id = u.department_id
               WHERE u.role = $1 AND u.department_id = $2 AND u.id != 0
               ORDER BY u.id LIMIT 1`,
              [dbRole, dsDeptId]);
            if (user) { actorName = user.full_name; actorId = user.id; deptName = user.department_name; }
          }
        } else {
          // Section department chain: search in the section's assigned departments
          if (sectionDeptIds.length > 0 && sectionDeptIds[0]) {
            const { rows: [user] } = await db.query(
              `SELECT u.id, u.full_name, d.name_en AS department_name
               FROM users u
               LEFT JOIN departments d ON d.id = u.department_id
               WHERE u.role = $1 AND u.department_id = ANY($2) AND u.id != 0
               ORDER BY u.id LIMIT 1`,
              [step, sectionDeptIds]);
            if (user) { actorName = user.full_name; actorId = user.id; deptName = user.department_name; }
          }
        }

        steps.push({ role: step, actorName, actorId, departmentName: deptName });
      }

      const status = s.status || 'draft';
      const holderRole = currentHolderRole(status, s.original_submitter_role, s.return_target_role, chain);

      // Load return request for this section (if any)
      const { rows: rrRows } = await db.query(
        `SELECT requested_by_name, requested_by_role, note, created_at
         FROM section_return_requests
         WHERE event_id = $1 AND section_id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [eventId, s.section_id]
      );
      const returnRequest = rrRows.length > 0 ? {
        from: rrRows[0].requested_by_name,
        fromRole: rrRows[0].requested_by_role,
        note: rrRows[0].note,
        at: rrRows[0].created_at,
      } : null;

      // Compute the requesting user's effective role for this section
      const userEffRole = await effectiveRole(req.user, event, sectionDeptIds, chain);

      enrichedSections.push({
        sectionId: s.section_id,
        sectionLabel: s.section_label,
        status,
        statusComment: s.status_comment,
        lastUpdatedAt: s.last_updated_at,
        lastUpdatedBy: s.last_updated_by,
        originalSubmitterRole: s.original_submitter_role,
        returnTargetRole: s.return_target_role,
        currentHolderRole: holderRole,
        userEffectiveRole: userEffRole,
        departmentIds: sectionDeptIds,
        departmentNames: sectionDeptNames,
        isCrossDept,
        chain,
        steps,
        returnRequest,
      });
    }

    res.json({
      event_id: parseInt(eventId),
      documentSubmitterRole: event.document_submitter_role,
      documentSubmitterId: event.document_submitter_id,
      deputyId: event.deputy_id,
      curatorRequired: event.curator_required,
      sections: enrichedSections,
    });
  } catch (err) {
    console.error('Status grid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/workflow/section-content ────────────────────────────────────────

router.get('/section-content', requireAuth, async (req, res) => {
  try {
    const { event_id, section_id } = req.query;
    if (!event_id || !section_id) {
      return res.status(400).json({ error: 'event_id and section_id are required' });
    }

    const { rows: [content] } = await db.query(
      `SELECT sc.html_content, sc.status, sc.last_content_edited_at,
              u.full_name AS last_edited_by
       FROM section_content sc
       LEFT JOIN users u ON u.id = sc.last_content_edited_by_user_id
       WHERE sc.event_id = $1 AND sc.section_id = $2`,
      [event_id, section_id]
    );

    if (!content) return res.status(404).json({ error: 'Content not found' });

    res.json({
      htmlContent: content.html_content,
      status: content.status,
      lastEditedAt: content.last_content_edited_at,
      lastEditedBy: content.last_edited_by,
    });
  } catch (err) {
    console.error('Section content error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Helper: check event completion ───────────────────────────────────────────

async function checkEventCompletion(eventId) {
  const { rows: sections } = await db.query(
    'SELECT status FROM section_content WHERE event_id = $1', [eventId]
  );
  // Check if all sections have been approved by the final role
  const allApproved = sections.length > 0 && sections.every(s =>
    s.status && s.status.startsWith('approved_by_')
  );
  // Don't auto-complete — DS must explicitly send to library
  // But we can update a flag or leave it for the frontend to enable the button
}

module.exports = router;
