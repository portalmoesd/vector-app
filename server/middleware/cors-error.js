function corsErrorHandler(err, req, res, next) {
  if (err && err.code === 'CORS_ORIGIN_DENIED') {
    return res.status(403).json({ error: 'Origin not allowed by CORS' });
  }
  return next(err);
}

module.exports = corsErrorHandler;
