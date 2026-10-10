import { describe, expect, it } from 'vitest';
import { Worker } from '../src/classes';

describe('Worker._getNextJob', () => {
  it.each(['closing', 'paused'] as const)(
    'does not move a job to active when the worker starts %s during the blocking wait',
    async state => {
      let resolveWait!: (blockUntil: number) => void;
      let moved = false;
      const worker: Record<string, unknown> = {
        drained: true,
        limitUntil: 0,
        waiting: null,
        blockUntil: 0,
        opts: {},
        waitForJob: () => new Promise<number>(r => (resolveWait = r)),
        moveToActive: async () => {
          moved = true;
        },
      };

      const next = (Worker.prototype as any)._getNextJob.call(worker, 'token');
      worker[state] = state === 'closing' ? Promise.resolve() : true;
      resolveWait(0);

      await expect(next).resolves.toBeUndefined();
      expect(moved).toBe(false);
    },
  );
});
