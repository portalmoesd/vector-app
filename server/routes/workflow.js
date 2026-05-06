const express = require('express');
const db = require('../db');
const { requireAuth, denyAnalyst } = require('../middleware/auth');
const { ROLES } = require('../helpers/roles');
const { canAccessEvent, canAccessSection } = require('../helpers/access');
const { checkEventCompletion } = require('../helpers/event-completion');
const { asOptionalTrimmedString, asPositiveInt, asTrimmedString, validationError } = require('../helpers/validation');
const logger = require('../logger');
const { sanitize } = require('../helpers/sanitize');
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
  canPushSection,
  canPullSection,
} = require('../helpers/pipeline');

const { MAX_EDITOR_HTML_LENGTH } = require('../helpers/constants');
const { resolveHomeDepartmentId } = require('../helpers/home-department');

const router = express.Router();

function parseEventSectionBody(req, res) {
  const eventId = asPositiveInt(req.body.eventId, 'eventId');
  if (eventId.error) {
    validationError(res, eventId.error);
    return null;
  }
  const sectionId = asPositiveInt(req.body.sectionId, 'sectionId');
  if (sectionId.error) {
    validationError(res, sectionId.error);
    return null;
  }
  return { eventId: eventId.value, sectionId: sectionId.value };
}

function parseEventSectionQuery(req, res) {
  const eventId = asPositiveInt(req.query.event_id, 'event_id');
  if (eventId.error) {
    validationError(res, eventId.error);
    return null;
  }
  const sectionId = asPositiveInt(req.query.section_id, 'section_id');
  if (sectionId.error) {
    validationError(res, sectionId.error);
    return null;
  }
  return { eventId: eventId.value, sectionId: sectionId.value };
}

function parseOptionalNote(value, field) {
  return asOptionalTrimmedString(value, field, { max: 10000 });
}

// ─── Helper: resolve user full name + department from DB ──────────────────────
// JWT doesn't carry full_name, so we look it up for history/audit records.
async function resolveUser(jwtUser) {
  const {
    rows: [row],
  } = await db.query('SELECT full_name, department_id FROM users WHERE id = $1', [jwtUser.id]);
  return {
    ...jwtUser,
    full_name: row ? row.full_name : jwtUser.username,
    department_id: row ? row.department_id : jwtUser.departmentId || null,
  };
}

// ─── Helper: load section context ─────────────────────────────────────────────

async function loadSectionContext(eventId, sectionId, jwtUser) {
  const {
    rows: [event],
  } = await db.query(
    `SELECT id, document_submitter_role, document_submitter_id, deputy_id,
            supervisor_id, curator_required, workflow_type, country_id,
            status AS event_status
     FROM events WHERE id = $1`,
    [eventId]
  );
  if (!event) return null;

  const {
    rows: [sc],
  } = await db.query(
    `SELECT status, original_submitter_role, return_target_role, last_updated_by_user_id
     FROM section_content WHERE event_id = $1 AND section_id = $2`,
    [eventId, sectionId]
  );
  if (!sc) return null;

  if (jwtUser && !(await canAccessSection(jwtUser, eventId, sectionId))) {
    return { forbidden: true };
  }

  const dsDeptId = await resolveHomeDepartmentId(event);
  const { rows: deptRows } = await db.query('SELECT department_id FROM section_departments WHERE section_id = $1', [
    sectionId,
  ]);
  const sectionDeptIds = deptRows.map((r) => r.department_id);
  const isCrossDept = sectionDeptIds.some((d) => d !== dsDeptId);

  const workflowType = event.workflow_type || 'advanced';
  const chain = buildChain(event.document_submitter_role, event.curator_required, isCrossDept, workflowType);

  // Resolve the user's effective role for THIS section. We honour the
  // amendment override here so every write handler picks up the same
  // canonical value via ctx.userRole — without it, save / submit /
  // return etc. compare the DS's JWT role (e.g. SUPERVISOR) to the
  // synthetic 'AMENDING_DS' holder and 403 the DS out of their own
  // amendment.
  let userRole = null;
  if (jwtUser) {
    if (sc.status === 'submitted_to_amending_ds' && jwtUser.id === event.document_submitter_id) {
      userRole = 'AMENDING_DS';
    } else {
      userRole = await effectiveRole(jwtUser, event, sectionDeptIds, chain);
    }
  }

  return {
    event,
    sectionStatus: sc.status || 'draft',
    originalSubmitterRole: sc.original_submitter_role,
    returnTargetRole: sc.return_target_role,
    lastUpdatedByUserId: sc.last_updated_by_user_id,
    chain,
    isCrossDept,
    dsDeptId,
    sectionDeptIds,
    workflowType,
    userRole,
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
  // Normalize department_id (JWT uses camelCase, resolveUser uses snake_case)
  const userDeptId = parseInt(user.department_id || user.departmentId) || null;
  // Deputy as Curator
  if (user.role === ROLES.DEPUTY && event.document_submitter_id !== user.id && sectionDeptIds) {
    const { rows } = await db.query(
      `SELECT 1 FROM deputy_department_links
       WHERE deputy_id = $1 AND department_id = ANY($2) LIMIT 1`,
      [user.id, sectionDeptIds]
    );
    if (rows.length > 0) return 'CURATOR';
  }

  // Check if user belongs to the receiving chain (home department)
  // But only if the user is NOT already acting as the section department's
  // actor for the same base role. A user in the section's department fills
  // the non-RECEIVING step; a user in the DS home department (but NOT in
  // the section's department) fills the RECEIVING_ step.
  if (chain && sectionDeptIds) {
    const receivingLabel = 'RECEIVING_' + user.role;
    if (chain.includes(receivingLabel)) {
      // If the user's base role is also in the chain as a non-receiving step
      // AND the user is in one of the section's departments, they are the
      // section department actor, not the receiving chain actor.
      const isInSectionDept = sectionDeptIds.includes(userDeptId);
      if (chain.includes(user.role) && isInSectionDept) {
        return user.role;
      }

      // Otherwise check if user is in the DS home department
      let homeDeptId = null;
      if (event.document_submitter_role === 'DEPUTY' && event.supervisor_id) {
        const {
          rows: [sv],
        } = await db.query('SELECT department_id FROM users WHERE id = $1', [event.supervisor_id]);
        homeDeptId = sv ? sv.department_id : null;
      } else {
        const {
          rows: [dsUser],
        } = await db.query('SELECT department_id FROM users WHERE id = $1', [event.document_submitter_id]);
        homeDeptId = dsUser ? dsUser.department_id : null;
      }
      if (homeDeptId && userDeptId === homeDeptId) {
        return receivingLabel;
      }
    }
  }

  return user.role;
}

// ─── POST /api/workflow/save ──────────────────────────────────────────────────

router.post('/save', requireAuth, denyAnalyst, async (req, res) => {
  try {
    const ids = parseEventSectionBody(req, res);
    if (!ids) return;
    const { eventId, sectionId } = ids;
    const htmlContent = asOptionalTrimmedString(req.body.htmlContent, 'htmlContent', { max: MAX_EDITOR_HTML_LENGTH });
    if (htmlContent.error) return validationError(res, htmlContent.error);

    // Authorization: only the current holder can save, and only in editable statuses
    const [ctx, resolvedUser] = await Promise.all([
      loadSectionContext(eventId, sectionId, req.user),
      resolveUser(req.user),
    ]);
    if (!ctx) return res.status(404).json({ error: 'Section not found' });
    if (ctx.forbidden) return res.status(403).json({ error: 'Not authorized to access this section' });

    const userRole = ctx.userRole;
    const holder = currentHolderRole(ctx.sectionStatus, ctx.originalSubmitterRole, ctx.returnTargetRole, ctx.chain);

    if (userRole !== holder) {
      return res.status(403).json({ error: `Section is held by ${holder}, not ${userRole}` });
    }

    await db.query(
      `UPDATE section_content
       SET html_content = $1,
           last_updated_by_user_id = $2,
           last_updated_at = now(),
           last_content_edited_at = now(),
           last_content_edited_by_user_id = $2
       WHERE event_id = $3 AND section_id = $4`,
      [sanitize(htmlContent.value || ''), req.user.id, eventId, sectionId]
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
    logger.error({ err }, 'Save error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/workflow/submit ────────────────────────────────────────────────

router.post('/submit', requireAuth, denyAnalyst, async (req, res) => {
  try {
    const ids = parseEventSectionBody(req, res);
    if (!ids) return;
    const { eventId, sectionId } = ids;

    const [ctx, resolvedUser] = await Promise.all([
      loadSectionContext(eventId, sectionId, req.user),
      resolveUser(req.user),
    ]);
    if (!ctx) return res.status(404).json({ error: 'Section not found' });
    if (ctx.forbidden) return res.status(403).json({ error: 'Not authorized to access this section' });

    const userRole = ctx.userRole;
    const holder = currentHolderRole(ctx.sectionStatus, ctx.originalSubmitterRole, ctx.returnTargetRole, ctx.chain);

    // Verify user is the current holder
    if (userRole !== holder) {
      return res.status(403).json({
        error: `Section is held by ${holder}, not ${userRole}`,
      });
    }

    // Verify section is in a submittable status (draft or returned)
    if (ctx.sectionStatus !== 'draft' && !ctx.sectionStatus.startsWith('returned_')) {
      return res.status(400).json({ error: `Cannot submit — section status is ${ctx.sectionStatus}` });
    }

    // Find the next role in the chain.
    // Simple-mode short-circuit: in simple workflow, the section's
    // department supervisor IS the final approver, so their "submit"
    // collapses into the final approval (no separate Approve click).
    const nextRole = nextInChain(userRole, ctx.chain);
    let toStatus;
    let historyAction = 'submitted';
    let didFinalApprove = false;
    if (!nextRole) {
      if (ctx.workflowType === 'simple' && isFinalApprover(userRole, ctx.chain)) {
        toStatus = approvedByStatus(userRole);
        historyAction = 'approved';
        didFinalApprove = true;
      } else {
        return res.status(400).json({ error: 'No next step in chain — use approve if you are the final approver' });
      }
    } else {
      toStatus = submittedToStatus(nextRole);
    }

    const fromStatus = ctx.sectionStatus;

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
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [eventId, sectionId, historyAction, fromStatus, toStatus, req.user.id, resolvedUser.full_name, userRole]
    );

    // Clear any pending return requests for this section
    await db.query('DELETE FROM section_return_requests WHERE event_id = $1 AND section_id = $2', [eventId, sectionId]);

    // Auto-complete the event if the simple-mode short-circuit just
    // fired and every section is now approved.
    if (didFinalApprove) {
      await checkEventCompletion(db, eventId);
    }

    res.json({ success: true, newStatus: toStatus });
  } catch (err) {
    logger.error({ err }, 'Submit error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/workflow/approve ───────────────────────────────────────────────

router.post('/approve', requireAuth, denyAnalyst, async (req, res) => {
  try {
    const ids = parseEventSectionBody(req, res);
    if (!ids) return;
    const { eventId, sectionId } = ids;
    const comment = parseOptionalNote(req.body.comment, 'comment');
    if (comment.error) return validationError(res, comment.error);

    const [ctx, resolvedUser] = await Promise.all([
      loadSectionContext(eventId, sectionId, req.user),
      resolveUser(req.user),
    ]);
    if (!ctx) return res.status(404).json({ error: 'Section not found' });
    if (ctx.forbidden) return res.status(403).json({ error: 'Not authorized to access this section' });

    const userRole = ctx.userRole;
    const holder = currentHolderRole(ctx.sectionStatus, ctx.originalSubmitterRole, ctx.returnTargetRole, ctx.chain);
    const isDS = req.user.id === ctx.event.document_submitter_id;

    // ── Amendment-approval branch ────────────────────────────────────
    // Reopened-event DS pull lands the section on
    // 'submitted_to_amending_ds'. Only the DS may approve from this
    // state, and the approval finalises the section under the DS's
    // own role (so it slots back into the existing approved_by_*
    // semantics that checkEventCompletion looks for).
    if (ctx.sectionStatus === 'submitted_to_amending_ds') {
      if (!isDS) {
        return res.status(403).json({ error: 'Only the Document Submitter can approve an amendment' });
      }
      const fromStatus = ctx.sectionStatus;
      // Use a dedicated final state so the chain bar's per-role actor
      // lookup never matches the DS into a chain slot. Still passes
      // checkEventCompletion's `startsWith('approved_by_')` test, so
      // simple-mode auto-publish kicks in once every section reaches
      // any approved_by_* state.
      const toStatus = 'approved_by_ds_amendment';

      await db.query(
        `UPDATE section_content
         SET status = $1, status_comment = $2,
             last_updated_by_user_id = $3, last_updated_at = now(),
             return_target_role = NULL
         WHERE event_id = $4 AND section_id = $5`,
        [toStatus, comment.value, req.user.id, eventId, sectionId]
      );
      // History row carries the synthetic role 'AMENDING_DS' instead
      // of the DS's JWT role. Same reasoning as the pull-section
      // history row above — keeps the chain bar's actor map clean.
      await db.query(
        `INSERT INTO section_history (event_id, section_id, action, from_status, to_status, user_id, user_name, user_role, note)
         VALUES ($1, $2, 'approved', $3, $4, $5, $6, $7, $8)`,
        [eventId, sectionId, fromStatus, toStatus, req.user.id, resolvedUser.full_name, 'AMENDING_DS', comment.value]
      );
      await db.query('DELETE FROM section_return_requests WHERE event_id = $1 AND section_id = $2', [
        eventId,
        sectionId,
      ]);
      await checkEventCompletion(db, eventId);
      return res.json({ success: true, newStatus: toStatus });
    }

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
    const isSimpleDsOverride = ctx.workflowType === 'simple' && isDS;
    let toStatus;
    let isFinal;

    if (isFinalApprover(userRole, ctx.chain) || isSimpleDsOverride) {
      // Final approval — DS in simple mode gets the same shortcut as a
      // chain-final approver. Marks the section approved_by_<userRole>.
      toStatus = approvedByStatus(userRole);
      isFinal = true;
    } else {
      // Mid-chain approval — submit to the next role in the chain
      const nextRole = nextInChain(userRole, ctx.chain);
      toStatus = submittedToStatus(nextRole);
      isFinal = false;
    }

    await db.query(
      `UPDATE section_content
       SET status = $1, status_comment = $2,
           last_updated_by_user_id = $3, last_updated_at = now(),
           return_target_role = NULL
       WHERE event_id = $4 AND section_id = $5`,
      [toStatus, comment.value, req.user.id, eventId, sectionId]
    );

    // Record history
    await db.query(
      `INSERT INTO section_history (event_id, section_id, action, from_status, to_status, user_id, user_name, user_role, note)
       VALUES ($1, $2, 'approved', $3, $4, $5, $6, $7, $8)`,
      [eventId, sectionId, fromStatus, toStatus, req.user.id, resolvedUser.full_name, userRole, comment.value]
    );

    // Clear any pending return requests
    await db.query('DELETE FROM section_return_requests WHERE event_id = $1 AND section_id = $2', [eventId, sectionId]);

    // If this was the final approval, check if all sections are approved → complete event
    if (isFinal) {
      await checkEventCompletion(db, eventId);
    }

    res.json({ success: true, newStatus: toStatus });
  } catch (err) {
    logger.error({ err }, 'Approve error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/workflow/return ────────────────────────────────────────────────

router.post('/return', requireAuth, denyAnalyst, async (req, res) => {
  try {
    const ids = parseEventSectionBody(req, res);
    if (!ids) return;
    const { eventId, sectionId } = ids;
    const comment = parseOptionalNote(req.body.comment, 'comment');
    if (comment.error) return validationError(res, comment.error);

    const [ctx, resolvedUser] = await Promise.all([
      loadSectionContext(eventId, sectionId, req.user),
      resolveUser(req.user),
    ]);
    if (!ctx) return res.status(404).json({ error: 'Section not found' });
    if (ctx.forbidden) return res.status(403).json({ error: 'Not authorized to access this section' });

    // Return doesn't apply to a DS amendment — the section was already
    // approved before the reopen, so there's no chain step to return
    // it to. Frontend hides the button (dashboard + editor); this is
    // the server-side belt-and-suspenders.
    if (ctx.sectionStatus === 'submitted_to_amending_ds') {
      return res.status(400).json({
        error: 'Cannot return an amendment — approve or leave it open',
      });
    }

    const userRole = ctx.userRole;
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
      [toStatus, comment.value, returnTarget, req.user.id, eventId, sectionId]
    );

    // Record history
    await db.query(
      `INSERT INTO section_history (event_id, section_id, action, from_status, to_status, user_id, user_name, user_role, note)
       VALUES ($1, $2, 'returned', $3, $4, $5, $6, $7, $8)`,
      [eventId, sectionId, fromStatus, toStatus, req.user.id, resolvedUser.full_name, userRole, comment.value]
    );

    // Clear any pending ask-to-return requests — the return fulfills them
    await db.query('DELETE FROM section_return_requests WHERE event_id = $1 AND section_id = $2', [eventId, sectionId]);

    res.json({ success: true, newStatus: toStatus, returnTargetRole: returnTarget });
  } catch (err) {
    logger.error({ err }, 'Return error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/workflow/ask-to-return ─────────────────────────────────────────

router.post('/ask-to-return', requireAuth, denyAnalyst, async (req, res) => {
  try {
    const ids = parseEventSectionBody(req, res);
    if (!ids) return;
    const { eventId, sectionId } = ids;
    const note = parseOptionalNote(req.body.note, 'note');
    if (note.error) return validationError(res, note.error);

    const [ctx, resolvedUser] = await Promise.all([
      loadSectionContext(eventId, sectionId, req.user),
      resolveUser(req.user),
    ]);
    if (!ctx) return res.status(404).json({ error: 'Section not found' });
    if (ctx.forbidden) return res.status(403).json({ error: 'Not authorized to access this section' });

    const userRole = ctx.userRole;

    // The user's effective role must be part of this section's chain
    if (!ctx.chain.includes(userRole)) {
      return res.status(403).json({ error: "You are not part of this section's approval chain" });
    }

    // The section must NOT be at the requester's stage (they can't ask-to-return their own stage)
    const holder = currentHolderRole(ctx.sectionStatus, ctx.originalSubmitterRole, ctx.returnTargetRole, ctx.chain);
    if (userRole === holder) {
      return res.status(400).json({ error: 'You currently hold this section — use return instead' });
    }

    // The section must have already passed the requester's step
    const userIdx = ctx.chain.indexOf(userRole);
    const holderIdx = ctx.chain.indexOf(holder);
    if (holderIdx <= userIdx) {
      return res.status(400).json({ error: 'The section has not passed your step yet' });
    }

    // Broadcast upward to all roles above requester in the chain
    await db.query(
      `INSERT INTO section_return_requests
       (event_id, section_id, requested_by_user_id, requested_by_name, requested_by_role, broadcast_above_role, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [eventId, sectionId, req.user.id, resolvedUser.full_name, userRole, userRole, note.value]
    );

    // Record history
    await db.query(
      `INSERT INTO section_history (event_id, section_id, action, from_status, to_status, user_id, user_name, user_role, note)
       VALUES ($1, $2, 'asked_to_return', $3, $3, $4, $5, $6, $7)`,
      [eventId, sectionId, ctx.sectionStatus, req.user.id, resolvedUser.full_name, userRole, note.value]
    );

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Ask-to-return error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/workflow/return-requests ─────────────────────────────────────────

router.get('/return-requests', requireAuth, async (req, res) => {
  try {
    const eventId = asPositiveInt(req.query.event_id, 'event_id');
    if (eventId.error) return validationError(res, eventId.error);
    const sectionId = req.query.section_id !== undefined ? asPositiveInt(req.query.section_id, 'section_id') : null;
    if (sectionId && sectionId.error) return validationError(res, sectionId.error);
    const allowed = sectionId
      ? await canAccessSection(req.user, eventId.value, sectionId.value)
      : await canAccessEvent(req.user, eventId.value);
    if (!allowed) {
      return res.status(403).json({ error: 'Not authorized to access return requests' });
    }

    let query = `SELECT id, event_id, section_id, requested_by_user_id,
                        requested_by_name, requested_by_role, broadcast_above_role,
                        note, created_at
                 FROM section_return_requests WHERE event_id = $1`;
    const params = [eventId.value];

    if (sectionId) {
      query += ' AND section_id = $2';
      params.push(sectionId.value);
    }
    query += ' ORDER BY created_at DESC';

    const { rows } = await db.query(query, params);
    res.json(
      rows.map((r) => ({
        id: r.id,
        eventId: r.event_id,
        sectionId: r.section_id,
        requestedByUserId: r.requested_by_user_id,
        requestedByName: r.requested_by_name,
        requestedByRole: r.requested_by_role,
        broadcastAboveRole: r.broadcast_above_role,
        note: r.note,
        createdAt: r.created_at,
      }))
    );
  } catch (err) {
    logger.error({ err }, 'Return requests error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/workflow/send-to-library ───────────────────────────────────────

router.post('/send-to-library', requireAuth, denyAnalyst, async (req, res) => {
  try {
    const eventId = asPositiveInt(req.body.eventId, 'eventId');
    if (eventId.error) return validationError(res, eventId.error);

    // Verify user is the Document Submitter
    const {
      rows: [event],
    } = await db.query('SELECT document_submitter_id, status FROM events WHERE id = $1', [eventId.value]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.document_submitter_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the Document Submitter can send to library' });
    }

    // Verify all sections are fully approved
    const { rows: sections } = await db.query(`SELECT sc.status FROM section_content sc WHERE sc.event_id = $1`, [
      eventId.value,
    ]);

    const allApproved = sections.every((s) => s.status.startsWith('approved_by_'));
    if (!allApproved) {
      return res.status(400).json({ error: 'All sections must be approved before sending to library' });
    }

    await db.query(
      "UPDATE events SET status = 'COMPLETED', is_active = false, ended_at = now(), updated_at = now() WHERE id = $1",
      [eventId.value]
    );

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Send to library error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/workflow/push-section ──────────────────────────────────────────

router.post('/push-section', requireAuth, denyAnalyst, async (req, res) => {
  try {
    const ids = parseEventSectionBody(req, res);
    if (!ids) return;
    const { eventId, sectionId } = ids;

    const [ctx, resolvedUser] = await Promise.all([
      loadSectionContext(eventId, sectionId, req.user),
      resolveUser(req.user),
    ]);
    if (!ctx) return res.status(404).json({ error: 'Section not found' });
    if (ctx.forbidden) return res.status(403).json({ error: 'Not authorized to access this section' });

    const userRole = ctx.userRole;
    const holder = currentHolderRole(ctx.sectionStatus, ctx.originalSubmitterRole, ctx.returnTargetRole, ctx.chain);
    const isLastActor = ctx.lastUpdatedByUserId != null && ctx.lastUpdatedByUserId == req.user.id;

    if (!canPushSection(userRole, ctx.chain, ctx.isCrossDept, holder, isLastActor, ctx.workflowType)) {
      return res.status(400).json({ error: 'Push is not available for this section' });
    }

    const fromStatus = ctx.sectionStatus;
    // Advanced mode pushes to RECEIVING_SUPER_COLLABORATOR (cross-dept
    // expedite); simple mode pushes straight to the final approval state
    // for the chain (since there's no Department A receiving chain).
    const isSimplePush = ctx.workflowType === 'simple';
    const finalChainRole = ctx.chain[ctx.chain.length - 1];
    const toStatus = isSimplePush
      ? approvedByStatus(finalChainRole)
      : submittedToStatus('RECEIVING_SUPER_COLLABORATOR');
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
       VALUES ($1, $2, 'pushed', $3, $4, $5, $6, $7)`,
      [eventId, sectionId, fromStatus, toStatus, req.user.id, resolvedUser.full_name, userRole]
    );

    // Clear any pending return requests
    await db.query('DELETE FROM section_return_requests WHERE event_id = $1 AND section_id = $2', [eventId, sectionId]);

    // Simple-mode push lands on approved_by_*, so trigger the same
    // auto-completion check as a final approval.
    if (isSimplePush) {
      await checkEventCompletion(db, eventId);
    }

    res.json({ success: true, newStatus: toStatus });
  } catch (err) {
    logger.error({ err }, 'Push section error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/workflow/pull-section ──────────────────────────────────────────
router.post('/pull-section', requireAuth, denyAnalyst, async (req, res) => {
  try {
    const ids = parseEventSectionBody(req, res);
    if (!ids) return;
    const { eventId, sectionId } = ids;

    const [ctx, resolvedUser] = await Promise.all([
      loadSectionContext(eventId, sectionId, req.user),
      resolveUser(req.user),
    ]);
    if (!ctx) return res.status(404).json({ error: 'Section not found' });
    if (ctx.forbidden) return res.status(403).json({ error: 'Not authorized to access this section' });

    const userRole = ctx.userRole;
    const holder = currentHolderRole(ctx.sectionStatus, ctx.originalSubmitterRole, ctx.returnTargetRole, ctx.chain);
    const isDS = req.user.id === ctx.event.document_submitter_id;

    // Simple-mode DS pulls use the user's actual role (e.g. DEPUTY)
    // even though it isn't in the chain — that's the override that
    // canPullSection allows.
    const pullingRole = ctx.workflowType === 'simple' && isDS ? req.user.role : userRole;

    if (
      !canPullSection(pullingRole, ctx.chain, holder, {
        workflowType: ctx.workflowType,
        isDS,
        status: ctx.sectionStatus,
        eventStatus: ctx.event.event_status,
      })
    ) {
      return res.status(400).json({ error: 'Pull is not available for this section' });
    }

    const fromStatus = ctx.sectionStatus;
    // Reopened-event DS pull lands on a dedicated 'amendment' state
    // that lives outside the chain. The chain bar keeps showing the
    // original approval history; only a separate "Amendment in
    // progress" indicator appears. Approve from this state finalises
    // the section as approved_by_<dsRole> — see /approve.
    const isAmendmentPull = ctx.workflowType === 'simple' && isDS && ctx.sectionStatus.startsWith('approved_by_');
    const toStatus = isAmendmentPull ? 'submitted_to_amending_ds' : submittedToStatus(pullingRole);
    const origRole = ctx.originalSubmitterRole || ctx.chain[0];

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

    // Record history. For amendment pulls, label the row with the
    // synthetic 'AMENDING_DS' role so the per-section chain-actor
    // lookup (status-grid) doesn't latch the DS into the SUPERVISOR /
    // SUPER_COLLABORATOR / etc. slot just because the DS happens to
    // have one of those JWT roles. Audit log keeps the user_id +
    // user_name so there's no loss of traceability.
    const historyRole = isAmendmentPull ? 'AMENDING_DS' : pullingRole;
    await db.query(
      `INSERT INTO section_history (event_id, section_id, action, from_status, to_status, user_id, user_name, user_role)
       VALUES ($1, $2, 'pulled', $3, $4, $5, $6, $7)`,
      [eventId, sectionId, fromStatus, toStatus, req.user.id, resolvedUser.full_name, historyRole]
    );

    // Clear any pending return requests
    await db.query('DELETE FROM section_return_requests WHERE event_id = $1 AND section_id = $2', [eventId, sectionId]);

    res.json({ success: true, newStatus: toStatus });
  } catch (err) {
    logger.error({ err }, 'Pull section error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/workflow/status-grid ────────────────────────────────────────────

router.get('/status-grid', requireAuth, async (req, res) => {
  try {
    const eventId = asPositiveInt(req.query.event_id, 'event_id');
    if (eventId.error) return validationError(res, eventId.error);

    const {
      rows: [event],
    } = await db.query(
      `SELECT id, document_submitter_role, document_submitter_id,
              deputy_id, supervisor_id, curator_required, workflow_type, country_id,
              status AS event_status
       FROM events WHERE id = $1`,
      [eventId.value]
    );
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (!(await canAccessEvent(req.user, eventId.value))) {
      return res.status(403).json({ error: 'Not authorized to access this event' });
    }
    const eventWorkflowType = event.workflow_type || 'advanced';

    const dsDeptId = await resolveHomeDepartmentId(event);

    const { rows: sections } = await db.query(
      `SELECT s.id AS section_id, s.title AS section_label,
              sc.status, sc.status_comment, sc.last_updated_at,
              sc.original_submitter_role, sc.return_target_role,
              sc.last_updated_by_user_id,
              u.full_name AS last_updated_by,
              sc.last_content_edited_by_user_id
       FROM sections s
       LEFT JOIN section_content sc ON sc.section_id = s.id AND sc.event_id = s.event_id
       LEFT JOIN users u ON u.id = sc.last_updated_by_user_id
       WHERE s.event_id = $1
       ORDER BY s.sort_order`,
      [eventId.value]
    );

    // Build a lookup of the last actor per (section, role) from history.
    // Used to show who actually acted on multi-user steps instead of a static pick.
    const { rows: historyRows } = await db.query(
      `SELECT DISTINCT ON (sh.section_id, sh.user_role)
         sh.section_id, sh.user_role, sh.user_id, sh.user_name,
         d.name_en AS department_name
       FROM section_history sh
       LEFT JOIN users u ON u.id = sh.user_id
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE sh.event_id = $1
       ORDER BY sh.section_id, sh.user_role, sh.acted_at DESC`,
      [eventId.value]
    );
    const historyActors = {};
    for (const h of historyRows) {
      if (!historyActors[h.section_id]) historyActors[h.section_id] = {};
      historyActors[h.section_id][h.user_role] = {
        actorName: h.user_name,
        actorId: h.user_id,
        departmentName: h.department_name,
      };
    }

    // Batch-load department assignments for all sections
    const sectionIds = sections.map((s) => s.section_id);
    const { rows: allDeptRows } = await db.query(
      `SELECT sd.section_id, sd.department_id, d.name_en AS department_name
       FROM section_departments sd
       LEFT JOIN departments d ON d.id = sd.department_id
       WHERE sd.section_id = ANY($1)`,
      [sectionIds]
    );
    const deptsBySection = {};
    for (const r of allDeptRows) {
      if (!deptsBySection[r.section_id]) deptsBySection[r.section_id] = [];
      deptsBySection[r.section_id].push(r);
    }

    // Batch-load latest return requests for all sections
    const { rows: allReturnRequests } = await db.query(
      `SELECT DISTINCT ON (section_id)
         section_id, requested_by_name, requested_by_role, note, created_at
       FROM section_return_requests
       WHERE event_id = $1
       ORDER BY section_id, created_at DESC`,
      [eventId.value]
    );
    const returnRequestBySection = {};
    for (const rr of allReturnRequests) {
      returnRequestBySection[rr.section_id] = {
        from: rr.requested_by_name,
        fromRole: rr.requested_by_role,
        note: rr.note,
        at: rr.created_at,
      };
    }

    // Batch-load latest return actions for all returned sections
    const { rows: allReturnInfo } = await db.query(
      `SELECT DISTINCT ON (section_id)
         section_id, user_name, user_role, note, acted_at
       FROM section_history
       WHERE event_id = $1 AND action = 'returned'
       ORDER BY section_id, acted_at DESC`,
      [eventId.value]
    );
    const returnInfoBySection = {};
    for (const ri of allReturnInfo) {
      returnInfoBySection[ri.section_id] = {
        from: ri.user_name,
        fromRole: ri.user_role,
        note: ri.note,
        at: ri.acted_at,
      };
    }

    // Pre-fetch the DS user for DEPUTY step resolution (one query instead of per-section)
    let dsUser = null;
    if (event.document_submitter_role === 'DEPUTY') {
      const { rows: [u] } = await db.query('SELECT id, full_name FROM users WHERE id = $1', [event.document_submitter_id]);
      dsUser = u || null;
    }

    // Cache curator lookups by department set to avoid duplicate queries
    const curatorCache = new Map();

    const enrichedSections = [];
    for (const s of sections) {
      const deptRows = deptsBySection[s.section_id] || [];
      const sectionDeptIds = deptRows.map((r) => r.department_id);
      const sectionDeptNames = deptRows.map((r) => r.department_name).filter(Boolean);
      const isCrossDept = sectionDeptIds.some((d) => d !== dsDeptId);
      const chain = buildChain(event.document_submitter_role, event.curator_required, isCrossDept, eventWorkflowType);

      // Resolve actor names for each step in the chain
      const steps = [];
      for (const step of chain) {
        let actorName = null;
        let actorId = null;
        let deptName = null;

        if (step === 'CURATOR') {
          const cacheKey = [...sectionDeptIds].sort().join(',');
          if (curatorCache.has(cacheKey)) {
            const cached = curatorCache.get(cacheKey);
            actorName = cached.actorName;
            actorId = cached.actorId;
          } else {
            const {
              rows: [dep],
            } = await db.query(
              `SELECT u.id, u.full_name
               FROM deputy_department_links ddl
               JOIN users u ON u.id = ddl.deputy_id
               WHERE ddl.department_id = ANY($1) AND u.id != $2
               ORDER BY u.id LIMIT 1`,
              [sectionDeptIds, event.document_submitter_id]
            );
            const result = dep ? { actorName: dep.full_name, actorId: dep.id } : { actorName: null, actorId: null };
            curatorCache.set(cacheKey, result);
            actorName = result.actorName;
            actorId = result.actorId;
          }
          deptName = null;
        } else if (step === ROLES.DEPUTY && event.document_submitter_role === 'DEPUTY') {
          if (dsUser) {
            actorName = dsUser.full_name;
            actorId = dsUser.id;
          }
          deptName = null;
        } else {
          const hist = (historyActors[s.section_id] || {})[step];
          if (hist) {
            actorName = hist.actorName;
            actorId = hist.actorId;
            deptName = hist.departmentName;
          }
        }

        const acted = !!(historyActors[s.section_id] || {})[step];
        steps.push({ role: step, actorName, actorId, departmentName: deptName, acted });
      }

      const status = s.status || 'draft';
      const holderRole = currentHolderRole(status, s.original_submitter_role, s.return_target_role, chain);

      const returnRequest = returnRequestBySection[s.section_id] || null;
      const returnInfo = status.startsWith('returned_by_') ? returnInfoBySection[s.section_id] || null : null;

      const isAmendmentDS = status === 'submitted_to_amending_ds' && req.user.id === event.document_submitter_id;
      const userEffRole = isAmendmentDS ? 'AMENDING_DS' : await effectiveRole(req.user, event, sectionDeptIds, chain);

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
        canPush: canPushSection(
          userEffRole,
          chain,
          isCrossDept,
          holderRole,
          s.last_updated_by_user_id != null && s.last_updated_by_user_id == req.user.id,
          eventWorkflowType
        ),
        canPull: canPullSection(userEffRole, chain, holderRole, {
          workflowType: eventWorkflowType,
          isDS: req.user.id === event.document_submitter_id,
          status: s.status,
          eventStatus: event.event_status,
        }),
        returnRequest,
        returnInfo,
      });
    }

    res.json({
      event_id: eventId.value,
      documentSubmitterRole: event.document_submitter_role,
      documentSubmitterId: event.document_submitter_id,
      deputyId: event.deputy_id,
      curatorRequired: event.curator_required,
      workflowType: eventWorkflowType,
      homeDepartmentId: dsDeptId,
      sections: enrichedSections,
    });
  } catch (err) {
    logger.error({ err }, 'Status grid error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/workflow/stage-users ─────────────────────────────────────────────

router.get('/stage-users', requireAuth, async (req, res) => {
  try {
    const ids = parseEventSectionQuery(req, res);
    if (!ids) return;
    const { eventId, sectionId } = ids;
    const role = asTrimmedString(req.query.role, 'role', { required: true, max: 80 });
    if (role.error) return validationError(res, role.error);
    if (!/^[A-Z_]+$/.test(role.value)) {
      return validationError(res, 'role must contain only uppercase letters and underscores');
    }

    const {
      rows: [event],
    } = await db.query(
      `SELECT id, document_submitter_role, document_submitter_id,
              supervisor_id, curator_required, workflow_type, country_id
       FROM events WHERE id = $1`,
      [eventId]
    );
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (!(await canAccessSection(req.user, eventId, sectionId))) {
      return res.status(403).json({ error: 'Not authorized to access this section' });
    }
    const stageWorkflowType = event.workflow_type || 'advanced';

    const dsDeptId = await resolveHomeDepartmentId(event);

    // Section departments
    const { rows: deptRows } = await db.query('SELECT department_id FROM section_departments WHERE section_id = $1', [
      sectionId,
    ]);
    const sectionDeptIds = deptRows.map((r) => r.department_id);
    const isCrossDept = sectionDeptIds.some((d) => d !== dsDeptId);
    const chain = buildChain(event.document_submitter_role, event.curator_required, isCrossDept, stageWorkflowType);

    if (!chain.includes(role.value)) {
      return res.status(400).json({ error: 'Role is not in the approval chain for this section' });
    }

    let users = [];

    if (role.value === 'CURATOR') {
      const { rows } = await db.query(
        `SELECT u.id, u.full_name, d.name_en AS department_name
         FROM deputy_department_links ddl
         JOIN users u ON u.id = ddl.deputy_id
         LEFT JOIN departments d ON d.id = u.department_id
         WHERE ddl.department_id = ANY($1) AND u.id != $2
         ORDER BY u.full_name`,
        [sectionDeptIds, event.document_submitter_id]
      );
      users = rows;
    } else if (role.value === 'DEPUTY') {
      const { rows } = await db.query(
        `SELECT u.id, u.full_name, d.name_en AS department_name
         FROM users u
         LEFT JOIN departments d ON d.id = u.department_id
         WHERE u.id = $1`,
        [event.document_submitter_id]
      );
      users = rows;
    } else if (role.value.startsWith('RECEIVING_')) {
      const dbRole = baseRole(role.value);
      if (dsDeptId) {
        const { rows } = await db.query(
          `SELECT u.id, u.full_name, d.name_en AS department_name
           FROM users u
           LEFT JOIN departments d ON d.id = u.department_id
           LEFT JOIN country_assignments ca ON ca.user_id = u.id AND ca.country_id = $3
           WHERE u.role = $1 AND u.department_id = $2
             AND (ca.user_id IS NOT NULL
                  OR NOT EXISTS (SELECT 1 FROM country_assignments ca2 WHERE ca2.user_id = u.id))
           ORDER BY u.full_name`,
          [dbRole, dsDeptId, event.country_id]
        );
        users = rows;
      }
    } else {
      if (sectionDeptIds.length > 0 && sectionDeptIds[0]) {
        const { rows } = await db.query(
          `SELECT u.id, u.full_name, d.name_en AS department_name
           FROM users u
           LEFT JOIN departments d ON d.id = u.department_id
           LEFT JOIN country_assignments ca ON ca.user_id = u.id AND ca.country_id = $3
           WHERE u.role = $1 AND u.department_id = ANY($2)
             AND (ca.user_id IS NOT NULL
                  OR NOT EXISTS (SELECT 1 FROM country_assignments ca2 WHERE ca2.user_id = u.id))
          ORDER BY u.full_name`,
          [role.value, sectionDeptIds, event.country_id]
        );
        users = rows;
      }
    }

    res.json({
      role: role.value,
      users: users.map((u) => ({
        id: u.id,
        fullName: u.full_name,
        departmentName: u.department_name,
      })),
    });
  } catch (err) {
    logger.error({ err }, 'Stage users error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/workflow/section-content ────────────────────────────────────────

router.get('/section-content', requireAuth, async (req, res) => {
  try {
    const ids = parseEventSectionQuery(req, res);
    if (!ids) return;
    const { eventId, sectionId } = ids;
    if (!(await canAccessSection(req.user, eventId, sectionId))) {
      return res.status(403).json({ error: 'Not authorized to access this section' });
    }

    const {
      rows: [content],
    } = await db.query(
      `SELECT sc.html_content, sc.status, sc.last_content_edited_at,
              u.full_name AS last_edited_by
       FROM section_content sc
       LEFT JOIN users u ON u.id = sc.last_content_edited_by_user_id
       WHERE sc.event_id = $1 AND sc.section_id = $2`,
      [eventId, sectionId]
    );

    if (!content) return res.status(404).json({ error: 'Content not found' });

    res.json({
      htmlContent: content.html_content,
      status: content.status,
      lastEditedAt: content.last_content_edited_at,
      lastEditedBy: content.last_edited_by,
    });
  } catch (err) {
    logger.error({ err }, 'Section content error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
