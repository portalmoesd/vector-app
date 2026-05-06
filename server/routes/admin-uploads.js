/**
 * Shared helpers for admin-only XLSX/CSV file uploads.
 *
 * Uploads are persisted in the `admin_uploads` Postgres table so they
 * survive container restarts and redeploys (Render's filesystem is
 * ephemeral; anything written under server/data/ at runtime is wiped
 * on the next deploy).
 *
 * Intended usage (from a specific route file):
 *
 *   const { upload, adminOnly, saveParsedAndRaw, loadParsed } =
 *     require('./admin-uploads');
 *
 *   router.post('/my-kind/upload', ...adminOnly, upload.single('file'),
 *     async (req, res) => {
 *       const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
 *       const parsed = parseMyKind(wb);
 *       parsed.uploadedAt = new Date().toISOString();
 *       await saveParsedAndRaw('my-kind', parsed, req.file.buffer);
 *       // ...update in-memory cache, return response...
 *     });
 */

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const config = require('../config');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const logger = require('../logger');

// Legacy disk path — used only for one-shot migration of previously
// uploaded files the first time the DB-backed version boots.
const LEGACY_DATA_DIR = path.join(__dirname, '../data');
const MAX_ADMIN_UPLOAD_BYTES = config.megabytesToBytes(config.adminUploadMaxMb);
const ALLOWED_ADMIN_UPLOAD_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'text/plain',
]);
const ALLOWED_ADMIN_UPLOAD_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);

function isAllowedAdminUpload(file) {
  const ext = path.extname(file?.originalname || '').toLowerCase();
  return ALLOWED_ADMIN_UPLOAD_MIME_TYPES.has(file?.mimetype) || ALLOWED_ADMIN_UPLOAD_EXTENSIONS.has(ext);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ADMIN_UPLOAD_BYTES, files: 1 },
  fileFilter(req, file, cb) {
    if (!isAllowedAdminUpload(file)) {
      return cb(new Error('Unsupported admin upload type. Use XLSX, XLS, or CSV files.'));
    }
    return cb(null, true);
  },
});

function handleAdminUpload(fieldName = 'file') {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `Upload must be ${config.adminUploadMaxMb}MB or smaller` });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Upload accepts one file at a time' });
      }
      return res.status(400).json({ error: err.message || 'Invalid upload' });
    });
  };
}

// Spread this into route definitions: router.post('/x', ...adminOnly, handler)
const adminOnly = [requireAuth, requireRole('ADMIN')];

async function saveParsedAndRaw(kind, parsed, buffer) {
  await db.query(
    `INSERT INTO admin_uploads (kind, parsed_json, raw_bytes, uploaded_at)
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (kind) DO UPDATE
       SET parsed_json = EXCLUDED.parsed_json,
           raw_bytes   = COALESCE(EXCLUDED.raw_bytes, admin_uploads.raw_bytes),
           uploaded_at = EXCLUDED.uploaded_at`,
    [kind, JSON.stringify(parsed), buffer || null]
  );
}

async function loadParsed(kind) {
  try {
    const { rows } = await db.query('SELECT parsed_json FROM admin_uploads WHERE kind = $1', [kind]);
    return rows.length ? rows[0].parsed_json : null;
  } catch (err) {
    logger.error('admin-uploads: loadParsed(%s) failed: %s', kind, err.message);
    return null;
  }
}

// One-shot migration: for each legacy file still on disk, if the DB
// doesn't already have that row, import it so admins don't have to
// re-upload after switching to the DB-backed store.
async function migrateLegacyDiskUploadsOnce() {
  if (!fs.existsSync(LEGACY_DATA_DIR)) return;
  let entries;
  try {
    entries = fs.readdirSync(LEGACY_DATA_DIR);
  } catch (_) {
    return;
  }
  for (const file of entries) {
    if (!file.endsWith('.json')) continue;
    const kind = file.slice(0, -5);
    try {
      const { rows } = await db.query('SELECT 1 FROM admin_uploads WHERE kind = $1', [kind]);
      if (rows.length) continue; // already in DB
      const jsonPath = path.join(LEGACY_DATA_DIR, `${kind}.json`);
      const xlsxPath = path.join(LEGACY_DATA_DIR, `${kind}.xlsx`);
      const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const buffer = fs.existsSync(xlsxPath) ? fs.readFileSync(xlsxPath) : null;
      await saveParsedAndRaw(kind, parsed, buffer);
      logger.info(`admin-uploads: migrated "${kind}" from disk to DB`);
    } catch (err) {
      logger.warn(`admin-uploads: legacy migration for "${kind}" failed: %s`, err.message);
    }
  }
}

module.exports = {
  upload,
  handleAdminUpload,
  isAllowedAdminUpload,
  adminOnly,
  saveParsedAndRaw,
  loadParsed,
  migrateLegacyDiskUploadsOnce,
};
