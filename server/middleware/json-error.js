const config = require('../config');

function jsonErrorHandler(err, req, res, next) {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON request body' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: `JSON request body must be ${config.jsonBodyLimitMb}MB or smaller` });
  }
  return next(err);
}

module.exports = jsonErrorHandler;
