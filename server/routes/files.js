const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth, denyAnalyst } = require('../middleware/auth');
const { canAccessSection } = require('../helpers/access');
const { asPositiveInt, validationError } = require('../helpers/validation');

const router = express.Router();
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
  'text/plain',
  'text/csv',
]);

// Use memory storage — files are stored in the database (BYTEA), not on disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 10 },
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error(`Unsupported file type: ${file.mimetype || 'unknown'}`));
    }
    return cb(null, true);
  },
});

function handleUpload(req, res, next) {
  upload.array('files', 10)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Each file must be 50MB or smaller' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Upload supports up to 10 files at once' });
    }
    return res.status(400).json({ error: err.message || 'Invalid upload' });
  });
}

function contentDispositionFilename(name) {
  const clean = String(name || 'download').replace(/["\\\r\n]/g, '_');
  const asciiFallback = clean.replace(/[^\x20-\x7E]/g, '_') || 'download';
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

// POST /api/workflow/files/upload
router.post('/upload', requireAuth, denyAnalyst, handleUpload, async (req, res) => {
  try {
    const eventId = asPositiveInt(req.body.eventId, 'eventId');
    if (eventId.error) return validationError(res, eventId.error);
    const sectionId = asPositiveInt(req.body.sectionId, 'sectionId');
    if (sectionId.error) return validationError(res, sectionId.error);
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'At least one file is required' });
    }
    if (!(await canAccessSection(req.user, eventId.value, sectionId.value))) {
      return res.status(403).json({ error: 'Not authorized to access this section' });
    }

    // Look up uploader name from DB (JWT only has id/username/role)
    const userRow = await db.query(`SELECT full_name FROM users WHERE id = $1`, [req.user.id]);
    const uploaderName = userRow.rows[0]?.full_name || req.user.username;

    const uploaded = [];
    for (const f of (req.files || [])) {
      const originalName = String(f.originalname || 'upload').replace(/[\\/\r\n]/g, '_').slice(0, 500);
      const storedName = Date.now() + '-' + Math.round(Math.random() * 1e9) + '-' + originalName;
      const row = await db.query(
        `INSERT INTO section_files (event_id, section_id, original_name, stored_name, mime_type, size, uploaded_by_id, uploaded_by_name, file_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, original_name, stored_name, mime_type, size, uploaded_by_id, created_at`,
        [eventId.value, sectionId.value, originalName, storedName, f.mimetype, f.size, req.user.id, uploaderName, f.buffer]
      );
      uploaded.push(row.rows[0]);
    }

    res.json({ success: true, files: uploaded });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/workflow/files/list
router.get('/list', requireAuth, async (req, res) => {
  try {
    const eventId = asPositiveInt(req.query.eventId, 'eventId');
    if (eventId.error) return validationError(res, eventId.error);
    const sectionId = asPositiveInt(req.query.sectionId, 'sectionId');
    if (sectionId.error) return validationError(res, sectionId.error);
    if (!(await canAccessSection(req.user, eventId.value, sectionId.value))) {
      return res.status(403).json({ error: 'Not authorized to access this section' });
    }

    const result = await db.query(
      `SELECT id, original_name, stored_name, mime_type, size, uploaded_by_id, uploaded_by_name, created_at
       FROM section_files
       WHERE event_id = $1 AND section_id = $2
       ORDER BY created_at DESC`,
      [eventId.value, sectionId.value]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('List files error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/workflow/files/download
router.get('/download', requireAuth, async (req, res) => {
  try {
    const id = asPositiveInt(req.query.id, 'id');
    if (id.error) return validationError(res, id.error);

    const result = await db.query(
      `SELECT id, event_id, section_id, original_name, mime_type, file_data FROM section_files WHERE id = $1`,
      [id.value]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'File not found' });

    const file = result.rows[0];
    if (!(await canAccessSection(req.user, file.event_id, file.section_id))) {
      return res.status(403).json({ error: 'Not authorized to access this file' });
    }
    if (!file.file_data) {
      return res.status(404).json({ error: 'File data not available. Please re-upload the file.' });
    }

    res.set('Content-Type', file.mime_type || 'application/octet-stream');
    res.set('Content-Disposition', contentDispositionFilename(file.original_name));
    res.send(file.file_data);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/workflow/files/delete
router.post('/delete', requireAuth, denyAnalyst, async (req, res) => {
  try {
    const id = asPositiveInt(req.body.id, 'id');
    if (id.error) return validationError(res, id.error);

    const result = await db.query(
      `SELECT event_id, section_id, uploaded_by_id FROM section_files WHERE id = $1`,
      [id.value]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'File not found' });

    const file = result.rows[0];
    if (!(await canAccessSection(req.user, file.event_id, file.section_id))) {
      return res.status(403).json({ error: 'Not authorized to access this file' });
    }

    // Only the uploader or an admin can delete
    if (file.uploaded_by_id !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Not authorized to delete this file' });
    }

    // Remove from DB (file_data is deleted with the row)
    await db.query(`DELETE FROM section_files WHERE id = $1`, [id.value]);

    res.json({ success: true });
  } catch (err) {
    console.error('Delete file error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
