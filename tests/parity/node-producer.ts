import { produceEvents } from './producer';
import { getBackend, logEvent } from './utils';

async function main() {
  const backend = getBackend();

  // Producer sends a ready event, then creates the jobs
  logEvent('ready');

  await produceEvents(backend.options, backend.factory);

  process.exit(0);
}

main().catch(err => {
  console.error('Error running producer', err);
  process.exit(1);
});
