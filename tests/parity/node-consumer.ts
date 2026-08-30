import { setUpWorkers } from './consumer';
import { getBackend, logEvent } from './utils';

async function main() {
  const backend = getBackend();

  setUpWorkers(backend.options, backend.factory);

  // Consumer creates workers first, then sends a ready event
  logEvent('ready');
}

main().catch(err => console.error('Error running consumer', err));
