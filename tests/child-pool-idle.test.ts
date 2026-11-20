import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChildPool } from '../src/classes/child-pool';

describe.each([false, true])(
  'Child pool idle timeout (useWorkerThreads: %s)',
  useWorkerThreads => {
    let pool: ChildPool;
    const processor = join(__dirname, 'fixtures/fixture_processor_bar.js');

    function createPool(idleTimeout?: number) {
      pool = new ChildPool({
        mainFile: join(
          process.cwd(),
          'dist/cjs/classes',
          useWorkerThreads ? 'main-worker.js' : 'main.js',
        ),
        useWorkerThreads,
        idleTimeout,
      });
      return pool;
    }

    afterEach(async () => {
      // Real IPC and exit events must continue to run during cleanup.
      vi.useRealTimers();
      await pool?.clean();
    });

    it('closes an idle processor and starts a fresh one for the next job', async () => {
      createPool(1000);
      const child = await pool.retain(processor);
      vi.useFakeTimers();
      pool.release(child);
      const exited = once(child, 'exit');

      await vi.advanceTimersByTimeAsync(1000);
      await exited;
      expect(pool.getAllFree()).toHaveLength(0);
      expect(child.exitCode).not.toBeNull();

      vi.useRealTimers();
      const replacement = await pool.retain(processor);
      expect(replacement).not.toBe(child);
      expect(replacement.exitCode).toBeNull();
    });

    it('cancels the timeout while retained and restarts it on release', async () => {
      createPool(1000);
      const child = await pool.retain(processor);
      vi.useFakeTimers();
      pool.release(child);
      await vi.advanceTimersByTimeAsync(500);

      expect(await pool.retain(processor)).toBe(child);
      await vi.advanceTimersByTimeAsync(2000);
      expect(child.exitCode).toBeNull();
      expect(pool.retained[child.pid]).toBe(child);

      pool.release(child);
      await vi.advanceTimersByTimeAsync(999);
      expect(child.exitCode).toBeNull();
      const exited = once(child, 'exit');
      await vi.advanceTimersByTimeAsync(1);
      await exited;
      expect(pool.getAllFree()).toHaveLength(0);
    });

    it.each([undefined, 0])(
      'keeps reusing idle processors when timeout is %s',
      async idleTimeout => {
        createPool(idleTimeout);
        const child = await pool.retain(processor);
        vi.useFakeTimers();
        pool.release(child);
        await vi.advanceTimersByTimeAsync(60_000);

        expect(child.exitCode).toBeNull();
        expect(await pool.retain(processor)).toBe(child);
      },
    );

    it('expires idle processors independently without closing retained ones', async () => {
      createPool(1000);
      const first = await pool.retain(processor);
      const second = await pool.retain(processor);
      const retained = await pool.retain(processor);
      vi.useFakeTimers();
      pool.release(first);
      await vi.advanceTimersByTimeAsync(500);
      pool.release(second);

      const firstExited = once(first, 'exit');
      await vi.advanceTimersByTimeAsync(500);
      await firstExited;
      expect(pool.getAllFree()).toEqual([second]);
      expect(second.exitCode).toBeNull();
      expect(retained.exitCode).toBeNull();

      const secondExited = once(second, 'exit');
      await vi.advanceTimersByTimeAsync(500);
      await secondExited;
      expect(pool.getAllFree()).toHaveLength(0);
      expect(retained.exitCode).toBeNull();
    });

    it('cancels idle timers when a processor exits independently', async () => {
      createPool(1000);
      const child = await pool.retain(processor);
      vi.useFakeTimers();
      pool.release(child);
      await child.kill();

      expect(pool.getAllFree()).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('closes retained and idle processors and clears their timers', async () => {
      createPool(1000);
      const retained = await pool.retain(processor);
      const idle = await pool.retain(processor);
      vi.useFakeTimers();
      pool.release(idle);
      await pool.clean();

      expect(retained.exitCode).not.toBeNull();
      expect(idle.exitCode).not.toBeNull();
      expect(pool.getAllFree()).toHaveLength(0);
      expect(Object.keys(pool.retained)).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('waits for an idle processor already shutting down during clean', async () => {
      createPool(1000);
      const child = await pool.retain(processor);
      vi.useFakeTimers();
      pool.release(child);
      // Fire the timeout without yielding to the real process exit event.
      vi.advanceTimersByTime(1000);
      await pool.clean();

      expect(child.exitCode).not.toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });
  },
);

describe('Child pool idle timeout validation', () => {
  it.each([-1, 0.5, NaN, Infinity, 2_147_483_648])(
    'rejects an invalid timeout: %s',
    idleTimeout => {
      expect(() => new ChildPool({ idleTimeout })).toThrow(
        'idleTimeout must be an integer between 0 and 2147483647',
      );
    },
  );
});

it('keeps the first worker thread retained when an idle thread exits', async () => {
  // A fresh Node process guarantees that the retained thread has ID 1.
  // After an idle thread exits, Node reports its threadId as -1 and Child.pid
  // therefore becomes 1. Removing it must not remove the retained thread.
  const script = `
    const { ChildPool } = require('./dist/cjs/classes/child-pool');
    const { once } = require('node:events');
    const { resolve } = require('node:path');
    (async () => {
      const pool = new ChildPool({
        mainFile: resolve('dist/cjs/classes/main-worker.js'),
        useWorkerThreads: true,
        idleTimeout: 20,
      });
      const processor = resolve('tests/fixtures/fixture_processor_bar.js');
      const retained = await pool.retain(processor);
      const idle = await pool.retain(processor);
      try {
        const exited = once(idle, 'exit');
        pool.release(idle);
        await exited;
        console.log(pool.retained[retained.pid] === retained);
      } finally {
        await pool.clean();
        await retained.kill();
      }
    })().catch(err => { console.error(err); process.exitCode = 1; });
  `;
  const { stdout } = await promisify(execFile)(process.execPath, [
    '-e',
    script,
  ]);
  expect(stdout.trim()).toBe('true');
});
