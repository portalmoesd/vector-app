const config = require('./config');
const createApp = require('./app');
const { bootstrapDatabase } = require('./bootstrap');

async function start() {
  await bootstrapDatabase();

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`Vector Portal running on port ${config.port}`);
  });
}

start().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
