const express = require('express');
const db = require('../db');
const { requireAuth, denyAnalyst } = require('../middleware/auth');
const { canAccessSection } = require('../helpers/access');
const { asOptionalTrimmedString, asPositiveInt, asTrimmedString, validationError } = require('../helpers/validation');
const logger = require('../logger');
const { sanitize } = require('../helpers/sanitize');
const { MAX_EDITOR_HTML_LENGTH } = require('../helpers/constants');

const router = express.Router();

// GET /api/workflow/comments?event_id=X&section_id=Y
router.get('/', requireAuth, async (req, res) => {
  try {
    const eventId = asPositiveInt(req.query.event_id, 'event_id');
    if (eventId.error) return validationError(res, eventId.error);
    const sectionId = asPositiveInt(req.query.section_id, 'section_id');
    if (sectionId.error) return validationError(res, sectionId.error);
    if (!(await canAccessSection(req.user, eventId.value, sectionId.value))) {
      return res.status(403).json({ error: 'Not authorized to access this section' });
    }
    const { rows } = await db.query(
      `SELECT sc.id, sc.anchor_id, sc.parent_id, sc.content, sc.created_at,
              sc.user_id, u.full_name, u.username
       FROM section_comments sc
       JOIN users u ON u.id = sc.user_id
       WHERE sc.event_id = $1 AND sc.section_id = $2
       ORDER BY sc.created_at`,
      [eventId.value, sectionId.value]
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        anchorId: r.anchor_id,
        parentId: r.parent_id || null,
        content: r.content,
        createdAt: r.created_at,
        userId: r.user_id,
        userName: r.full_name,
        username: r.username,
      }))
    );
  } catch (err) {
    logger.error({ err }, 'List comments error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/workflow/comments
router.post('/', requireAuth, denyAnalyst, async (req, res) => {
  try {
    const eventId = asPositiveInt(req.body.eventId, 'eventId');
    if (eventId.error) return validationError(res, eventId.error);
    const sectionId = asPositiveInt(req.body.sectionId, 'sectionId');
    if (sectionId.error) return validationError(res, sectionId.error);
    const parentId = asPositiveInt(req.body.parentId, 'parentId', { required: false });
    if (parentId.error) return validationError(res, parentId.error);
    const anchorId = asOptionalTrimmedString(req.body.anchorId, 'anchorId', { max: 200 });
    if (anchorId.error) return validationError(res, anchorId.error);
    const content = asTrimmedString(req.body.content, 'content', { required: true, max: 10000 });
    if (content.error) return validationError(res, content.error);
    const htmlContent = asOptionalTrimmedString(req.body.htmlContent, 'htmlContent', { max: MAX_EDITOR_HTML_LENGTH });
    if (htmlContent.error) return validationError(res, htmlContent.error);
    if (!(await canAccessSection(req.user, eventId.value, sectionId.value))) {
      return res.status(403).json({ error: 'Not authorized to access this section' });
    }
    const { rows } = await db.query(
      `INSERT INTO section_comments (event_id, section_id, user_id, parent_id, anchor_id, content)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [eventId.value, sectionId.value, req.user.id, parentId.value, anchorId.value, content.value]
    );

    // Auto-save editor HTML so the comment anchor is persisted
    if (htmlContent.value) {
      await db.query(
        `UPDATE section_content
         SET html_content = $1, last_updated_at = now(),
             last_updated_by_user_id = $2
         WHERE event_id = $3 AND section_id = $4`,
        [sanitize(htmlContent.value), req.user.id, eventId.value, sectionId.value]
      );
    }

    res.status(201).json({ id: rows[0].id, success: true });
  } catch (err) {
    logger.error({ err }, 'Create comment error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/workflow/comments/delete  (frontend calls this as POST)
router.post('/delete', requireAuth, denyAnalyst, async (req, res) => {
  try {
    const commentId = asPositiveInt(req.body.commentId, 'commentId');
    if (commentId.error) return validationError(res, commentId.error);
    const result = await db.query('DELETE FROM section_comments WHERE id = $1 AND user_id = $2', [
      commentId.value,
      req.user.id,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Comment not found' });
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Delete comment error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Keep DELETE /:id for API consumers
router.delete('/:id', requireAuth, denyAnalyst, async (req, res) => {
  try {
    const commentId = asPositiveInt(req.params.id, 'id');
    if (commentId.error) return validationError(res, commentId.error);
    const result = await db.query('DELETE FROM section_comments WHERE id = $1 AND user_id = $2', [
      commentId.value,
      req.user.id,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Comment not found' });
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Delete comment error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
