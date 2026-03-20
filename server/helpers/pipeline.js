const { ROLES } = require('./roles');

/**
 * Pipeline order (index = priority, higher = further in chain)
 */
const PIPELINE_ORDER = [
  ROLES.COLLABORATOR,        // 0
  ROLES.SUPER_COLLABORATOR,  // 1
  'CURATOR',                 // 2 (contextual label for Deputy)
  ROLES.SUPERVISOR,          // 3
  ROLES.DEPUTY,              // 4
];

/**
 * Section status enum values
 */
const STATUS = {
  DRAFT: 'draft',
  SUBMITTED_TO_SUPER_COLLABORATOR: 'submitted_to_super_collaborator',
  RETURNED_BY_SUPER_COLLABORATOR: 'returned_by_super_collaborator',
  APPROVED_BY_SUPER_COLLABORATOR: 'approved_by_super_collaborator',
  SUBMITTED_TO_CURATOR: 'submitted_to_curator',
  RETURNED_BY_CURATOR: 'returned_by_curator',
  APPROVED_BY_CURATOR: 'approved_by_curator',
  SUBMITTED_TO_SUPERVISOR: 'submitted_to_supervisor',
  RETURNED_BY_SUPERVISOR: 'returned_by_supervisor',
  APPROVED_BY_SUPERVISOR: 'approved_by_supervisor',
  SUBMITTED_TO_DEPUTY: 'submitted_to_deputy',
  RETURNED_BY_DEPUTY: 'returned_by_deputy',
  APPROVED_BY_DEPUTY: 'approved_by_deputy',
};

/**
 * Determine who currently holds a section based on its status.
 */
function currentHolderRole(status, originalSubmitterRole, returnTargetRole) {
  if (status === STATUS.DRAFT) {
    return originalSubmitterRole || ROLES.COLLABORATOR;
  }
  if (status.startsWith('returned_')) {
    return returnTargetRole || originalSubmitterRole || ROLES.COLLABORATOR;
  }
  if (status.startsWith('submitted_to_')) {
    const target = status.replace('submitted_to_', '').toUpperCase();
    if (target === 'CURATOR') return 'CURATOR';
    return target;
  }
  if (status.startsWith('approved_by_')) {
    const approver = status.replace('approved_by_', '').toUpperCase();
    return nextRoleAfter(approver);
  }
  return originalSubmitterRole || ROLES.COLLABORATOR;
}

/**
 * Get the next role in the pipeline after the given role.
 */
function nextRoleAfter(role) {
  const idx = PIPELINE_ORDER.indexOf(role);
  if (idx === -1 || idx === PIPELINE_ORDER.length - 1) return null;
  return PIPELINE_ORDER[idx + 1];
}

/**
 * Get the status string for submitting to a target role.
 */
function submittedToStatus(targetRole) {
  return `submitted_to_${targetRole.toLowerCase()}`;
}

/**
 * Get the status string when a role approves.
 */
function approvedByStatus(role) {
  return `approved_by_${role.toLowerCase()}`;
}

/**
 * Get the status string when a role returns.
 */
function returnedByStatus(role) {
  return `returned_by_${role.toLowerCase()}`;
}

/**
 * Build the pipeline chain for a section given the event context.
 *
 * Returns an ordered list of role steps the section must pass through,
 * based on the Document Submitter's role and whether curator is required.
 *
 * The chain is intentionally simplified to the role-level — department-specific
 * parallel tracks are managed via the section_departments assignments, while
 * the status-based progression works on a single linear role chain per section.
 *
 * @param {string} dsRole - Document Submitter role (DEPUTY, SUPERVISOR, SUPER_COLLABORATOR)
 * @param {boolean} curatorRequired - Whether curator review is required
 * @param {boolean} isCrossDept - Whether this section has cross-department assignments
 * @returns {string[]} Ordered list of role labels
 */
function buildChain(dsRole, curatorRequired, isCrossDept) {
  // Start with collaborator
  const chain = [ROLES.COLLABORATOR];

  if (dsRole === 'SUPER_COLLABORATOR') {
    // Chain C: Collab → SC
    chain.push(ROLES.SUPER_COLLABORATOR);
    // For cross-dept, curator is optional between the dept chain and DS
    // But since SC IS the DS, no extra receiving chain needed
  } else if (dsRole === 'SUPERVISOR') {
    // Chain B: Collab → SC → Supervisor
    chain.push(ROLES.SUPER_COLLABORATOR);
    if (isCrossDept && curatorRequired) {
      chain.push('CURATOR');
    }
    chain.push(ROLES.SUPERVISOR);
  } else if (dsRole === 'DEPUTY') {
    // Chain A: Collab → SC → Supervisor → Deputy
    chain.push(ROLES.SUPER_COLLABORATOR);
    if (isCrossDept && curatorRequired) {
      chain.push('CURATOR');
    }
    chain.push(ROLES.SUPERVISOR);
    chain.push(ROLES.DEPUTY);
  }

  return chain;
}

/**
 * Determine the next role to submit to, given the current user's role
 * and the section's chain.
 *
 * @param {string} userRole - The submitting user's role (or 'CURATOR')
 * @param {string[]} chain - The pipeline chain for this section
 * @returns {string|null} The next role in the chain, or null if at the end
 */
function nextInChain(userRole, chain) {
  const idx = chain.indexOf(userRole);
  if (idx === -1 || idx >= chain.length - 1) return null;
  return chain[idx + 1];
}

/**
 * Check if the user's role is the final approver in the chain (Document Submitter).
 */
function isFinalApprover(userRole, chain) {
  return chain.length > 0 && chain[chain.length - 1] === userRole;
}

/**
 * Get the first role in the chain (the original editor level for returns).
 */
function firstEditorRole(chain) {
  return chain.length > 0 ? chain[0] : ROLES.COLLABORATOR;
}

module.exports = {
  PIPELINE_ORDER,
  STATUS,
  currentHolderRole,
  nextRoleAfter,
  submittedToStatus,
  approvedByStatus,
  returnedByStatus,
  buildChain,
  nextInChain,
  isFinalApprover,
  firstEditorRole,
};
