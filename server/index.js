const config = require('./config');
const createApp = require('./app');
const { bootstrapDatabase } = require('./bootstrap');
const db = require('./db');

async function start() {
  await bootstrapDatabase();

  const app = createApp({ initializeBackgroundJobs: true });
  const server = app.listen(config.port, () => {
    console.log(`Vector Portal running on port ${config.port}`);
  });

  async function shutdown(signal) {
    console.log(`${signal} received. Closing Vector Portal...`);
    server.close(async (err) => {
      if (err) {
        console.error('HTTP server shutdown failed:', err);
        process.exit(1);
      }

      try {
        await db.close();
        console.log('Database pool closed.');
        process.exit(0);
      } catch (closeErr) {
        console.error('Database shutdown failed:', closeErr);
        process.exit(1);
      }
    });

    setTimeout(() => {
      console.error('Forced shutdown after timeout.');
      process.exit(1);
    }, 10000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
