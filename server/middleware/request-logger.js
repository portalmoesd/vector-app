const logger = require('../logger');

function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    if (req.path === '/api/health' || req.path === '/api/ready') return;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info(
      {
        type: 'http_request',
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Number(durationMs.toFixed(1)),
        userId: req.user?.id || null,
      },
      '%s %s %d %sms',
      req.method,
      req.originalUrl,
      res.statusCode,
      durationMs.toFixed(1)
    );
  });

  next();
}

module.exports = requestLogger;
