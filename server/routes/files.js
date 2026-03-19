const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const uploadDir = path.join(__dirname, '../../uploads');

// Ensure uploads directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const eventDir = path.join(uploadDir, String(req.body.eventId || 'unknown'));
    if (!fs.existsSync(eventDir)) {
      fs.mkdirSync(eventDir, { recursive: true });
    }
    cb(null, eventDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  },
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// POST /api/workflow/files/upload
router.post('/upload', requireAuth, upload.array('files', 10), (req, res) => {
  try {
    const uploaded = (req.files || []).map(f => ({
      filename: f.originalname,
      storedName: f.filename,
      size: f.size,
    }));
    res.json({ success: true, files: uploaded });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/workflow/files/download
router.get('/download', requireAuth, (req, res) => {
  try {
    const { eventId, filename } = req.query;
    const filePath = path.join(uploadDir, String(eventId), filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.download(filePath);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
