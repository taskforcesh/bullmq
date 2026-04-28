import { ChildPool } from '../src/classes';
import { join } from 'path';
import { describe, beforeEach, afterEach, it, expect } from 'vitest';

const NoopProc = () => {};
describe('Child pool for Child Processes', () => {
  sandboxProcessTests();
});

describe('Child pool for Worker Threads', () => {
  sandboxProcessTests({
    mainFile: join(process.cwd(), 'dist/cjs/classes/main-worker.js'),
    useWorkerThreads: true,
  });
});

function sandboxProcessTests(
  {
    mainFile,
    useWorkerThreads,
  }: { mainFile?: string; useWorkerThreads?: boolean } = {
    useWorkerThreads: false,
  },
) {
  describe('Child pool', () => {
    let pool: ChildPool;

    beforeEach(() => {
      pool = new ChildPool({ mainFile, useWorkerThreads });
    });

    afterEach(() => pool.clean());

    it('should return same child if free', async () => {
      const processor = __dirname + '/fixtures/fixture_processor_bar.js';
      const child = await pool.retain(processor, NoopProc);
      expect(child).toBeTruthy();
      pool.release(child);
      expect(Object.keys(pool.retained)).toHaveLength(0);
      const newChild = await pool.retain(processor, NoopProc);
      expect(child).toEqual(newChild);
    });

    it('should return a new child if reused the last free one', async () => {
      const processor = __dirname + '/fixtures/fixture_processor_bar.js';
      let child = await pool.retain(processor, NoopProc);
      expect(child).toBeTruthy();
      pool.release(child);
      expect(Object.keys(pool.retained)).toHaveLength(0);
      let newChild = await pool.retain(processor, NoopProc);
      expect(child).toEqual(newChild);
      child = newChild;
      newChild = await pool.retain(processor, NoopProc);
      expect(child).not.toEqual(newChild);
    });

    it('should return a new child if none free', async () => {
      const processor = __dirname + '/fixtures/fixture_processor_bar.js';
      const child = await pool.retain(processor, NoopProc);
      expect(child).toBeTruthy();
      expect(Object.keys(pool.retained).length).toBeGreaterThan(0);
      const newChild = await pool.retain(processor, NoopProc);
      expect(child).not.toEqual(newChild);
    });

    it('should return a new child if killed', async () => {
      const processor = __dirname + '/fixtures/fixture_processor_bar.js';
      const child = await pool.retain(processor, NoopProc);
      expect(child).toBeTruthy();
      await pool.kill(child);
      expect(Object.keys(pool.retained)).toHaveLength(0);
      const newChild = await pool.retain(processor, NoopProc);
      expect(child).not.toEqual(newChild);
    });

    it('should return a new child if many retained and none free', async () => {
      const processor = __dirname + '/fixtures/fixture_processor_bar.js';
      const children = await Promise.all([
        pool.retain(processor, NoopProc),
        pool.retain(processor, NoopProc),
        pool.retain(processor, NoopProc),
        pool.retain(processor, NoopProc),
        pool.retain(processor, NoopProc),
        pool.retain(processor, NoopProc),
      ]);
      expect(children).toHaveLength(6);
      const child = await pool.retain(processor, NoopProc);
      expect(children).not.toContain(child);
    });

    it('should return an old child if many retained and one free', async () => {
      const processor = __dirname + '/fixtures/fixture_processor_bar.js';
      const children = await Promise.all([
        pool.retain(processor, NoopProc),
        pool.retain(processor, NoopProc),
        pool.retain(processor, NoopProc),
        pool.retain(processor, NoopProc),
        pool.retain(processor, NoopProc),
        pool.retain(processor, NoopProc),
      ]);

      expect(children).toHaveLength(6);
      pool.release(children[0]);
      const child = await pool.retain(processor);
      expect(children).toContain(child);
    });

    it('should consume execArgv array from process', async () => {
      const processor = __dirname + '/fixtures/fixture_processor_bar.js';
      process.execArgv.push('--no-warnings');

      const child = await pool.retain(processor, NoopProc);
      expect(child).toBeTruthy();
      if (!useWorkerThreads) {
        expect(child.childProcess.spawnargs).toContain('--no-warnings');
      }
    });

    // Regression: https://github.com/taskforcesh/bullmq/issues/1833
    // When the parent Node.js process is launched with `--watch`, the flag
    // must not be forwarded to sandboxed children. Inheriting it causes the
    // child runtime to also enter watch mode, which interferes with IPC and
    // leaves jobs stuck in the `active` state.
    it('should strip node --watch flags from execArgv before spawning the child', async () => {
      const processor = __dirname + '/fixtures/fixture_processor_bar.js';
      const watchFlags = [
        '--watch',
        '--watch-path=./src',
        '--watch-preserve-output',
        '--watch-kill-signal=SIGTERM',
      ];
      process.execArgv.push(...watchFlags);

      try {
        const child = await pool.retain(processor, NoopProc);
        expect(child).toBeTruthy();
        if (!useWorkerThreads) {
          const args = child.childProcess.spawnargs;
          for (const flag of watchFlags) {
            expect(args).not.toContain(flag);
          }
        }
      } finally {
        // Remove only the flags we added so we don't disturb sibling tests
        // that also mutate process.execArgv. We push() each flag onto the
        // end, so lastIndexOf() targets our own entry — using indexOf()
        // would remove a pre-existing --watch* if the runner itself was
        // started with `node --watch`.
        for (const flag of watchFlags) {
          const idx = process.execArgv.lastIndexOf(flag);
          if (idx !== -1) {
            process.execArgv.splice(idx, 1);
          }
        }
      }
    });
  });
}
