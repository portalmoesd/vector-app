const test = require('node:test');
const assert = require('node:assert/strict');
const {
  stripHtml,
  splitRecipients,
  buildEmailBody,
  resolveEventNotificationDraft,
} = require('./event-notification-draft');

test('stripHtml converts common editor HTML to readable text', () => {
  assert.equal(
    stripHtml('<p>Hello&nbsp;<strong>team</strong></p><p>Use A&amp;B</p>'),
    'Hello team\nUse A&B'
  );
});

test('splitRecipients deduplicates email addresses and reports missing emails', () => {
  const participants = new Map([
    [1, { id: 1, fullName: 'Ana', email: 'Ana@Example.com ', role: 'SUPERVISOR', departmentName: 'A', sourceRoles: ['Supervisor'] }],
    [2, { id: 2, fullName: 'Duplicate', email: 'ana@example.com', role: 'SUPERVISOR', departmentName: 'A', sourceRoles: ['Supervisor'] }],
    [3, { id: 3, fullName: 'No Email', email: '', role: 'COLLABORATOR', departmentName: 'B', sourceRoles: ['Collaborator'] }],
  ]);

  const result = splitRecipients(participants);
  assert.deepEqual(result.recipients.map(r => r.email), ['ana@example.com']);
  assert.deepEqual(result.missingEmails.map(r => r.fullName), ['No Email']);
});

test('buildEmailBody includes event summary and plain text task', () => {
  const body = buildEmailBody(
    {
      title: 'Quarterly report',
      country_name: 'France',
      deadline_date: '2026-05-15',
      workflow_type: 'simple',
      document_submitter_name: 'Mariam',
      document_submitter_role: 'SUPERVISOR',
      occasion: '<p>Prepare summary</p>',
    },
    [{ title: 'Trade', departments: [{ name: 'Economic Policy' }] }],
    [{ email: 'a@example.com' }],
    []
  );

  assert.match(body, /Title: Quarterly report/);
  assert.match(body, /Workflow: Simple/);
  assert.match(body, /- Trade \(Economic Policy\)/);
  assert.match(body, /Prepare summary/);
});

test('resolveEventNotificationDraft resolves workflow participants and missing emails', async () => {
  const users = {
    1: { id: 1, full_name: 'Document Submitter', email: 'ds@example.com', role: 'SUPERVISOR', department_name: 'Home', department_id: 20 },
    2: { id: 2, full_name: 'Collaborator', email: 'collab@example.com', role: 'COLLABORATOR', department_name: 'Home', department_id: 20 },
    3: { id: 3, full_name: 'Super Collaborator', email: 'sc@example.com', role: 'SUPER_COLLABORATOR', department_name: 'Home', department_id: 20 },
    4: { id: 4, full_name: 'Supervisor Duplicate', email: 'ds@example.com', role: 'SUPERVISOR', department_name: 'Home', department_id: 20 },
    5: { id: 5, full_name: 'Missing Email', email: '', role: 'COLLABORATOR', department_name: 'Home', department_id: 20 },
  };

  const fakeDb = {
    async query(sql, params) {
      if (sql.includes('FROM events e')) {
        return { rows: [{
          id: 9,
          title: 'Quarterly report',
          country_id: 10,
          country_name: 'France',
          document_submitter_role: 'SUPERVISOR',
          document_submitter_id: 1,
          deputy_id: null,
          supervisor_id: 1,
          curator_required: false,
          workflow_type: 'advanced',
          deadline_date: '2026-05-15',
          occasion: '<p>Prepare summary</p>',
          document_submitter_name: 'Document Submitter',
          deputy_name: null,
          supervisor_name: 'Document Submitter',
        }] };
      }

      if (sql.includes('json_agg')) {
        return { rows: [{
          id: 100,
          title: 'Trade',
          sort_order: 0,
          departments: [{ id: 20, name: 'Home' }],
        }] };
      }

      if (sql.includes('WHERE u.id = $1')) {
        return { rows: users[params[0]] ? [users[params[0]]] : [] };
      }

      if (sql.includes('u.department_id = ANY($2)')) {
        const role = params[0];
        return { rows: Object.values(users).filter(user => user.role === role) };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const draft = await resolveEventNotificationDraft(fakeDb, 9);
  assert.equal(draft.subject, 'New event: Quarterly report');
  assert.deepEqual(
    draft.recipients.map(r => r.email).sort(),
    ['collab@example.com', 'ds@example.com', 'sc@example.com']
  );
  assert.deepEqual(draft.missingEmails.map(r => r.fullName), ['Missing Email']);
});
