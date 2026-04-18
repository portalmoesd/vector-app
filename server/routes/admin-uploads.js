/**
 * Shared helpers for admin-only XLSX/CSV file uploads that land in
 * server/data/{kind}.json + server/data/{kind}.xlsx.
 *
 * Intended usage (from a specific route file):
 *
 *   const { upload, adminOnly, saveParsedAndRaw, loadParsedFromDisk } =
 *     require('./admin-uploads');
 *
 *   router.post('/my-kind/upload', ...adminOnly, upload.single('file'),
 *     (req, res) => {
 *       const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
 *       const parsed = parseMyKind(wb);
 *       parsed.uploadedAt = new Date().toISOString();
 *       saveParsedAndRaw('my-kind', parsed, req.file.buffer);
 *       // ...update in-memory cache, return response...
 *     });
 */

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requireAuth, requireRole } = require('../middleware/auth');

const DATA_DIR = path.join(__dirname, '../data');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Spread this into route definitions: router.post('/x', ...adminOnly, handler)
const adminOnly = [requireAuth, requireRole('ADMIN')];

function saveParsedAndRaw(kind, parsed, buffer) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, `${kind}.json`), JSON.stringify(parsed));
  if (buffer) fs.writeFileSync(path.join(DATA_DIR, `${kind}.xlsx`), buffer);
}

function loadParsedFromDisk(kind) {
  try {
    const p = path.join(DATA_DIR, `${kind}.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) { return null; }
}

module.exports = { upload, adminOnly, saveParsedAndRaw, loadParsedFromDisk };
