require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET || (isProduction ? null : 'dev-secret-change-me');

if (isProduction && (!jwtSecret || jwtSecret === 'dev-secret-change-me')) {
  throw new Error('JWT_SECRET must be set to a strong non-default value in production');
}

function parseOrigins(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

module.exports = {
  isProduction,
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret,
  port: parseInt(process.env.PORT, 10) || 3000,
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS),
  allowDefaultSeedUsers: process.env.ALLOW_DEFAULT_SEED_USERS === 'true' || !isProduction,
};
