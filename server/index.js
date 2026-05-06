const config = require('./config');
const createApp = require('./app');
const { bootstrapDatabase } = require('./bootstrap');
const db = require('./db');
const logger = require('./logger');

async function start() {
  await bootstrapDatabase();

  const app = createApp({ initializeBackgroundJobs: true });
  const server = app.listen(config.port, () => {
    logger.info(`Vector Portal running on port ${config.port}`);
  });

  async function shutdown(signal) {
    logger.info(`${signal} received. Closing Vector Portal...`);
    server.close(async (err) => {
      if (err) {
        logger.error({ err }, 'HTTP server shutdown failed');
        process.exit(1);
      }

      try {
        await db.close();
        logger.info('Database pool closed.');
        process.exit(0);
      } catch (closeErr) {
        logger.error({ err: closeErr }, 'Database shutdown failed');
        process.exit(1);
      }
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout.');
      process.exit(1);
    }, 10000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  logger.error({ err }, 'Startup failed');
  process.exit(1);
});
