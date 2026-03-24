const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const uploadDir = path.join(__dirname, '../../uploads');

// Ensure uploads directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadDir, String(req.body.eventId || 'unknown'), String(req.body.sectionId || 'unknown'));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  },
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// POST /api/workflow/files/upload
router.post('/upload', requireAuth, upload.array('files', 10), async (req, res) => {
  try {
    const { eventId, sectionId } = req.body;
    if (!eventId || !sectionId) {
      return res.status(400).json({ error: 'eventId and sectionId are required' });
    }

    // Look up uploader name from DB (JWT only has id/username/role)
    const userRow = await db.query(`SELECT full_name FROM users WHERE id = $1`, [req.user.id]);
    const uploaderName = userRow.rows[0]?.full_name || req.user.username;

    const uploaded = [];
    for (const f of (req.files || [])) {
      const row = await db.query(
        `INSERT INTO section_files (event_id, section_id, original_name, stored_name, mime_type, size, uploaded_by_id, uploaded_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, original_name, stored_name, mime_type, size, uploaded_by_id, created_at`,
        [eventId, sectionId, f.originalname, f.filename, f.mimetype, f.size, req.user.id, uploaderName]
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
    const { eventId, sectionId } = req.query;
    if (!eventId || !sectionId) {
      return res.status(400).json({ error: 'eventId and sectionId are required' });
    }

    const result = await db.query(
      `SELECT id, original_name, stored_name, mime_type, size, uploaded_by_id, uploaded_by_name, created_at
       FROM section_files
       WHERE event_id = $1 AND section_id = $2
       ORDER BY created_at DESC`,
      [eventId, sectionId]
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
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id is required' });

    const result = await db.query(
      `SELECT event_id, section_id, original_name, stored_name FROM section_files WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'File not found' });

    const file = result.rows[0];
    const filePath = path.join(uploadDir, String(file.event_id), String(file.section_id), file.stored_name);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }
    res.download(filePath, file.original_name);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/workflow/files/delete
router.post('/delete', requireAuth, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });

    const result = await db.query(
      `SELECT event_id, section_id, stored_name, uploaded_by_id FROM section_files WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'File not found' });

    const file = result.rows[0];

    // Only the uploader or an admin can delete
    if (file.uploaded_by_id !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Not authorized to delete this file' });
    }

    // Remove from disk
    const filePath = path.join(uploadDir, String(file.event_id), String(file.section_id), file.stored_name);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Remove from DB
    await db.query(`DELETE FROM section_files WHERE id = $1`, [id]);

    res.json({ success: true });
  } catch (err) {
    console.error('Delete file error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
