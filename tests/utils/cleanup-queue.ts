import { Queue } from '../../src/classes';
import { createTestConnection } from './connection-factory';

const DEFAULT_PREFIX = process.env.BULLMQ_TEST_PREFIX || 'bull';

/**
 * Backend-agnostic per-test cleanup.
 *
 * Removes all data for a queue through the backend's own `obliterate`, so it
 * behaves identically on Redis and PostgreSQL. This is the uniform replacement
 * for the shared suite's historic `removeAllQueueData(client, name)`, which was
 * defined over a raw Redis client (`scanStream`/`pipeline.del`) and therefore
 * could not work against a non-Redis backend — the reason the Postgres run had
 * to stub a no-op Redis client just to no-op it.
 *
 * `force: true` matches the brute-force intent of the old helper (it removes
 * even active jobs). On a fresh/empty queue this is a cheap no-op.
 */
export async function cleanupQueue(
  queueName: string,
  prefix: string = DEFAULT_PREFIX,
): Promise<void> {
  const queue = new Queue(queueName, {
    connection: createTestConnection(),
    prefix,
  });
  try {
    await queue.obliterate({ force: true });
  } finally {
    await queue.close();
  }
}
