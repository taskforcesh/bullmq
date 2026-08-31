import { setUpWorkers } from './consumer';
import { getBackend } from './utils/node';
import { logEvent } from './utils/shared';

async function main() {
  const backend = getBackend();

  await setUpWorkers(backend.options, backend.factory);

  // Consumer creates workers first, then sends a ready event
  logEvent('ready');
}

main().catch(err => console.error('Error running consumer', err));
