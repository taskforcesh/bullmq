import { produceEvents } from './producer';
import { getBunRedisBackendConnection, logEvent } from './utils';

async function main() {
  const connection = await getBunRedisBackendConnection();
  // Producer sends a ready event, then creates the jobs
  logEvent('ready');

  await produceEvents({ connection });

  process.exit(0);
}

main().catch(err => {
  console.error('Error running producer', err);
  process.exit(1);
});
