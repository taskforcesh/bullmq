import { expect } from 'chai';
import { ChildPool } from '../src/classes';
import { join } from 'path';

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
      expect(child).to.be.ok;
      pool.release(child);
      expect(pool.retained).to.be.empty;
      const newChild = await pool.retain(processor, NoopProc);
      expect(child).to.be.eql(newChild);
    });

    it('should return a new child if reused the last free one', async () => {
      const processor = __dirname + '/fixtures/fixture_processor_bar.js';
      let child = await pool.retain(processor, NoopProc);
      expect(child).to.be.ok;
      pool.release(child);
      expect(pool.retained).to.be.empty;
      let newChild = await pool.retain(processor, NoopProc);
      expect(child).to.be.eql(newChild);
      child = newChild;
      newChild = await pool.retain(processor, NoopProc);
      expect(child).not.to.be.eql(newChild);
    });

    it('should return a new child if none free', async () => {
      const processor = __dirname + '/fixtures/fixture_processor_bar.js';
      const child = await pool.retain(processor, NoopProc);
      expect(child).to.be.ok;
      expect(pool.retained).not.to.be.empty;
      const newChild = await pool.retain(processor, NoopProc);
      expect(child).to.not.be.eql(newChild);
    });

    it('should return a new child if killed', async () => {
      const processor = __dirname + '/fixtures/fixture_processor_bar.js';
      const child = await pool.retain(processor, NoopProc);
      expect(child).to.be.ok;
      await pool.kill(child);
      expect(pool.retained).to.be.empty;
      const newChild = await pool.retain(processor, NoopProc);
      expect(child).to.not.be.eql(newChild);
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
      expect(children).to.have.length(6);
      const child = await pool.retain(processor, NoopProc);
      expect(children).not.to.include(child);
    }).timeout(10000);

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

      expect(children).to.have.length(6);
      pool.release(children[0]);
      const child = await pool.retain(processor);
      expect(children).to.include(child);
    }).timeout(10000);

    it('should consume execArgv array from process', async () => {
      const processor = __dirname + '/fixtures/fixture_processor_bar.js';
      process.execArgv.push('--no-warnings');

      const child = await pool.retain(processor, NoopProc);
      expect(child).to.be.ok;
      if (!useWorkerThreads) {
        expect(child.childProcess.spawnargs).to.include('--no-warnings');
      }
    });
  });
}
