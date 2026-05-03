const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const securityHeaders = require('./middleware/security-headers');
const requestLogger = require('./middleware/request-logger');

function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use(requestLogger);

  app.use(cors({
    origin(origin, callback) {
      if (!origin || !config.isProduction || config.corsOrigins.length === 0) {
        return callback(null, true);
      }
      if (config.corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Origin not allowed by CORS'));
    },
  }));
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      service: 'vector-portal',
      environment: config.isProduction ? 'production' : 'development',
      timestamp: new Date().toISOString(),
    });
  });

  app.use(express.static(path.join(__dirname, '../frontend')));

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
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/templates', require('./routes/templates'));
  app.use('/api/statistics', require('./routes/statistics'));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });

  app.use((err, req, res, next) => {
    console.error('Unhandled request error:', err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = createApp;
