const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');

const app = express();

// ── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));

// ── API Routes ──────────────────────────────────────────────────────────────

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/departments', require('./routes/departments'));
app.use('/api/countries', require('./routes/countries'));
app.use('/api/events', require('./routes/events'));
app.use('/api/sections', require('./routes/sections'));
app.use('/api/workflow', require('./routes/workflow'));
app.use('/api/workflow/comments', require('./routes/comments'));
app.use('/api/workflow/files', require('./routes/files'));
app.use('/api/workflow', require('./routes/history'));
app.use('/api/library', require('./routes/library'));

// ── Start ───────────────────────────────────────────────────────────────────

app.listen(config.port, () => {
  console.log(`Vector Portal running on port ${config.port}`);
});

module.exports = app;
