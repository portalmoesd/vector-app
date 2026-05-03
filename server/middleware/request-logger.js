function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    if (req.path === '/api/health' || req.path === '/api/ready') return;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const userId = req.user && req.user.id ? ` user=${req.user.id}` : '';
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms${userId}`);
  });

  next();
}

module.exports = requestLogger;
