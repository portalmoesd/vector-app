const config = require('../config');

function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    if (req.path === '/api/health' || req.path === '/api/ready') return;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    if (config.logFormat === 'json') {
      console.log(JSON.stringify({
        type: 'http_request',
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Number(durationMs.toFixed(1)),
        userId: req.user?.id || null,
      }));
      return;
    }

    const userId = req.user && req.user.id ? ` user=${req.user.id}` : '';
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms${userId}`);
  });

  next();
}

module.exports = requestLogger;
