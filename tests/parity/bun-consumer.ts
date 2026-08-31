import { setUpWorkers } from './consumer';
import { logEvent } from './utils/shared';
import { getBunRedisBackendConnection } from './utils/bun';

async function main() {
  if (process.env.PARITY_BACKEND === 'postgres') {
    logEvent('not-supported');
    return;
  }

  const connection = await getBunRedisBackendConnection();

  await setUpWorkers({ connection });

  // Consumer creates workers first, then sends a ready event
  logEvent('ready');
}

main().catch(err => console.error('Error running consumer', err));
