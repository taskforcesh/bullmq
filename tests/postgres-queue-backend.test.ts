import { describe, expect, it, vi } from 'vitest';
import { PostgresQueueBackend } from '../src/postgres/postgres-queue-backend';

describe('PostgresQueueBackend', () => {
  it('batches lock renewal with the shared SQL command', async () => {
    const backend = Object.create(
      PostgresQueueBackend.prototype,
    ) as PostgresQueueBackend;
    const run = vi.fn().mockResolvedValue({
      rows: [{ id: 'job-2' }, { id: 'job-3' }],
    });

    (backend as any).queueName = 'test-queue';
    (backend as any).run = run;

    const failed = await backend.extendLocks(
      ['job-1', 'job-2', 'job-3'],
      ['token-1', 'token-2', 'token-3'],
      30_000,
    );

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('extend_locks', [
      'test-queue',
      ['job-1', 'job-2', 'job-3'],
      ['token-1', 'token-2', 'token-3'],
      30_000,
      expect.any(Number),
    ]);
    expect(failed).toEqual(['job-2', 'job-3']);
  });

  it('allows a far longer block than the Redis BZPOPMIN cap', () => {
    const backend = Object.create(
      PostgresQueueBackend.prototype,
    ) as PostgresQueueBackend;

    // Longer waits are safe: waitForJob shortens its timer to the next due
    // delayed job anyway.
    expect(backend.maximumBlockTimeout).toBeGreaterThan(10);
    // But it must fit in setTimeout, which fires immediately beyond ~24.8 days.
    expect(backend.maximumBlockTimeout * 1000).toBeLessThan(2 ** 31 - 1);
  });
});
