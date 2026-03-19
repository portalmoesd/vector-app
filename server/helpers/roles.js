const ROLES = {
  ADMIN: 'ADMIN',
  PROTOCOL: 'PROTOCOL',
  DEPUTY: 'DEPUTY',
  SUPERVISOR: 'SUPERVISOR',
  SUPER_COLLABORATOR: 'SUPER_COLLABORATOR',
  COLLABORATOR: 'COLLABORATOR',
};

// Roles that participate in the document approval pipeline
const PIPELINE_ROLES = [
  ROLES.COLLABORATOR,
  ROLES.SUPER_COLLABORATOR,
  ROLES.SUPERVISOR,
  ROLES.DEPUTY,
];

// Roles that can create events
const EVENT_CREATOR_ROLES = [
  ROLES.ADMIN,
  ROLES.PROTOCOL,
  ROLES.DEPUTY,
  ROLES.SUPERVISOR,
  ROLES.SUPER_COLLABORATOR,
];

// Roles that can end events
const EVENT_ENDER_ROLES = [
  ROLES.ADMIN,
  ROLES.PROTOCOL,
  ROLES.DEPUTY,
  ROLES.SUPERVISOR,
];

function isPipelineRole(role) {
  return PIPELINE_ROLES.includes(role);
}

function canCreateEvent(role) {
  return EVENT_CREATOR_ROLES.includes(role);
}

function canEndEvent(role) {
  return EVENT_ENDER_ROLES.includes(role);
}

module.exports = {
  ROLES,
  PIPELINE_ROLES,
  EVENT_CREATOR_ROLES,
  EVENT_ENDER_ROLES,
  isPipelineRole,
  canCreateEvent,
  canEndEvent,
};
