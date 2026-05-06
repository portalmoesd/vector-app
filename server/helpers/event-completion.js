async function checkEventCompletion(db, eventId) {
  // Auto-completion is only enabled in simple workflow mode. Advanced
  // mode keeps the manual "Send to library" gate.
  const {
    rows: [event],
  } = await db.query('SELECT workflow_type, status FROM events WHERE id = $1', [eventId]);
  if (!event) return false;

  const workflowType = event.workflow_type || 'advanced';
  if (workflowType !== 'simple') return false;
  if (event.status === 'COMPLETED') return false;

  const { rows: sections } = await db.query('SELECT status FROM section_content WHERE event_id = $1', [eventId]);
  if (sections.length === 0) return false;

  const allApproved = sections.every((s) => s.status && s.status.startsWith('approved_by_'));
  if (!allApproved) return false;

  await db.query(
    `UPDATE events
     SET status = 'COMPLETED', is_active = false, ended_at = now(), updated_at = now()
     WHERE id = $1 AND status <> 'COMPLETED'`,
    [eventId]
  );
  return true;
}

module.exports = { checkEventCompletion };
