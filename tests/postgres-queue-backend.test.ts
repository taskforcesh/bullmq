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
});
