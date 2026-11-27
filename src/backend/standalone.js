const { StateStore } = require('./store');
const { PetEngine } = require('./petEngine');
const { createBackendServer } = require('./server');

async function main() {
  const port = Number(process.env.COZY_CAT_PORT || 38472);
  const store = new StateStore();
  const engine = new PetEngine({ store });
  engine.start();

  const backend = createBackendServer({ engine, port });
  const info = await backend.start();
  console.log(`Cozy Cat backend listening on ${info.baseUrl} (WS: ${info.wsUrl})`);

  const shutdown = async () => {
    engine.stop();
    await backend.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
