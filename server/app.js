const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const db = require('./db');
const securityHeaders = require('./middleware/security-headers');
const requestLogger = require('./middleware/request-logger');
const corsErrorHandler = require('./middleware/cors-error');
const jsonErrorHandler = require('./middleware/json-error');
const logger = require('./logger');

function createApp(options = {}) {
  const app = express();
  const statisticsRouter = require('./routes/statistics');

  app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use(requestLogger);

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || !config.isProduction || config.corsOrigins.length === 0) {
          return callback(null, true);
        }
        if (config.corsOrigins.includes(origin)) {
          return callback(null, true);
        }
        const err = new Error('Origin not allowed by CORS');
        err.code = 'CORS_ORIGIN_DENIED';
        return callback(err);
      },
    })
  );
  app.use(corsErrorHandler);
  app.use(express.json({ limit: `${config.jsonBodyLimitMb}mb` }));
  app.use(jsonErrorHandler);

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      service: 'vector-portal',
      environment: config.isProduction ? 'production' : 'development',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/ready', async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({
        ok: true,
        service: 'vector-portal',
        database: true,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      res.status(503).json({
        ok: false,
        service: 'vector-portal',
        database: false,
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.use(express.static(path.join(__dirname, '../frontend')));

  // Dev-mode Swagger UI — serves the OpenAPI spec at /api-docs
  if (!config.isProduction) {
    try {
      const swaggerUi = require('swagger-ui-express');
      const jsYaml = require('js-yaml');
      const fs = require('fs');
      const specPath = path.join(__dirname, '../docs/openapi.yaml');
      const spec = jsYaml.load(fs.readFileSync(specPath, 'utf8'));
      app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec));
      logger.info('Swagger UI available at /api-docs');
    } catch (err) {
      logger.info('Swagger UI not loaded (install swagger-ui-express and js-yaml as devDependencies)');
    }
  }

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
  app.use('/api/statistics', statisticsRouter);

  if (options.initializeBackgroundJobs && typeof statisticsRouter.initializeStatisticsData === 'function') {
    statisticsRouter.initializeStatisticsData();
  }

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });

  app.use((err, req, res, next) => {
    logger.error({ err }, 'Unhandled request error');
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = createApp;
