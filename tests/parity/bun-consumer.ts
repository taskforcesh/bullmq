import { setUpWorkers } from './consumer';
import { getBunRedisBackendConnection, logEvent } from './utils';

async function main() {
  if (process.env.PARITY_BACKEND === 'postgres') {
    logEvent('not-supported');
    return;
  }

  const connection = await getBunRedisBackendConnection();

  setUpWorkers({ connection });

  // Consumer creates workers first, then sends a ready event
  logEvent('ready');
}

main().catch(err => console.error('Error running consumer', err));
