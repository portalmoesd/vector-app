require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET || (isProduction ? null : 'dev-secret-change-me');

if (isProduction && (!jwtSecret || jwtSecret === 'dev-secret-change-me')) {
  throw new Error('JWT_SECRET must be set to a strong non-default value in production');
}

if (isProduction && process.env.ALLOW_DEFAULT_SEED_USERS === 'true') {
  throw new Error('ALLOW_DEFAULT_SEED_USERS cannot be true in production');
}

function parseOrigins(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function resolveAllowDefaultSeedUsers(isProd, value) {
  if (isProd) return false;
  if (value === undefined) return true;
  return value === 'true';
}

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function megabytesToBytes(value) {
  return value * 1024 * 1024;
}

module.exports = {
  isProduction,
  databaseUrl: process.env.DATABASE_URL,
  databaseSslMode: process.env.DATABASE_SSL_MODE || 'auto',
  databasePoolMax: parsePositiveInt(process.env.DATABASE_POOL_MAX, 20),
  databaseIdleTimeoutMs: parsePositiveInt(process.env.DATABASE_IDLE_TIMEOUT_MS, 30_000),
  databaseConnectionTimeoutMs: parsePositiveInt(process.env.DATABASE_CONNECTION_TIMEOUT_MS, 10_000),
  authRateLimitWindowMs: parsePositiveInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  authRateLimitMax: parsePositiveInt(process.env.AUTH_RATE_LIMIT_MAX, 20),
  workflowUploadMaxMb: parsePositiveInt(process.env.WORKFLOW_UPLOAD_MAX_MB, 50),
  adminUploadMaxMb: parsePositiveInt(process.env.ADMIN_UPLOAD_MAX_MB, 50),
  jsonBodyLimitMb: parsePositiveInt(process.env.JSON_BODY_LIMIT_MB, 10),
  geostatTlsMode: process.env.GEOSTAT_TLS_MODE === 'strict' ? 'strict' : 'no-verify',
  jwtSecret,
  port: parseInt(process.env.PORT, 10) || 3000,
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS),
  logFormat: process.env.LOG_FORMAT === 'json' ? 'json' : 'text',
  allowDefaultSeedUsers: resolveAllowDefaultSeedUsers(isProduction, process.env.ALLOW_DEFAULT_SEED_USERS),
  resolveAllowDefaultSeedUsers,
  parsePositiveInt,
  megabytesToBytes,
};

if (isProduction && !module.exports.databaseUrl) {
  throw new Error('DATABASE_URL must be set in production');
}

if (isProduction && module.exports.corsOrigins.length === 0) {
  throw new Error('CORS_ORIGINS must include the production frontend origin');
}
