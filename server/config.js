require('dotenv').config();

module.exports = {
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  port: parseInt(process.env.PORT, 10) || 3000,
};
