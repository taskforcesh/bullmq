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
  });
}
