import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresBackend, withBackend } from '../../src';
import { getPostgresUrl } from './utils/postgres-url';

/**
 * PostgreSQL counterpart of the Redis `queue.retryJobs` flow cases in
 * tests/flow.test.ts, plus the #5088 repro: retrying a completed flow child
 * must put that child back on the parent's pending dependencies. On the
 * pre-0012 `retry_jobs` function the child returns to waiting while its
 * dependency stays processed, so the parent is released when another child
 * finishes.
 */
describe('PostgreSQL retryJobs flow dependencies', () => {
  const url = getPostgresUrl();
  const schema = `retry_${randomUUID().replace(/-/g, '')}`;
  const connection = {
    connectionString: url,
    schema,
    migrate: true,
  };
  const { Queue, Worker, FlowProducer } = withBackend(createPostgresBackend);
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    const queue = new Queue(`migrate-${randomUUID()}`, { connection });
    try {
      await queue.waitUntilReady();
    } finally {
      await queue.close();
    }
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });

  it('keeps the parent in waiting-children when retryJobs reruns one completed child', async () => {
    const name = `flow-retry-${randomUUID()}`;
    const queue = new Queue(name, { connection });
    const flow = new FlowProducer({ connection });
    const worker = new Worker(name, null, { connection, autorun: false });

    try {
      await queue.waitUntilReady();
      await flow.waitUntilReady();
      await worker.waitUntilReady();

      const { job: parent } = await flow.add({
        name: 'parent',
        queueName: name,
        children: [
          { name: 'A', queueName: name },
          { name: 'B', queueName: name },
        ],
      });

      const childA = await worker.getNextJob('t1', { block: false });
      expect(childA?.name).toBe('A');
      await childA!.moveToCompleted('a', 't1', false);

      const completedA = await queue.getJob(childA!.id!);
      expect(completedA?.attemptsMade).toBe(1);
      expect(completedA?.attemptsStarted).toBe(1);

      await queue.retryJobs({ state: 'completed' });

      const retriedA = await queue.getJob(childA!.id!);
      expect(await retriedA!.getState()).toBe('waiting');
      await expect(parent.getDependenciesCount()).resolves.toEqual({
        processed: 0,
        unprocessed: 2,
        ignored: 0,
        failed: 0,
      });
      // Redis moveJobsToWait does not reset attempts. The old function zeroed
      // them, so a retried job looked like it had never run.
      expect(retriedA?.attemptsMade).toBe(1);
      expect(retriedA?.attemptsStarted).toBe(1);

      const childB = await worker.getNextJob('t2', { block: false });
      expect(childB?.name).toBe('B');
      await childB!.moveToCompleted('b', 't2', false);

      expect(await (await queue.getJob(childA!.id!))!.getState()).toBe(
        'waiting',
      );
      expect(await (await queue.getJob(parent.id!))!.getState()).toBe(
        'waiting-children',
      );
      await expect(
        (await queue.getJob(parent.id!))!.getDependenciesCount(),
      ).resolves.toEqual({
        processed: 1,
        unprocessed: 1,
        ignored: 0,
        failed: 0,
      });
    } finally {
      await worker.close();
      await flow.close();
      await queue.close();
    }
  });

  it('moves completed children back to the parent dependencies', async () => {
    const queueName = `children-${randomUUID()}`;
    const parentQueueName = `parent-${randomUUID()}`;
    const queue = new Queue(queueName, { connection });
    const flow = new FlowProducer({ connection });
    let worker: InstanceType<typeof Worker> | undefined = new Worker(
      queueName,
      async () => {},
      { connection, drainDelay: 1 },
    );
    let completedCount = 0;
    const completing = new Promise<void>(resolve => {
      worker!.on('completed', () => {
        completedCount++;
        if (completedCount === 2) {
          resolve();
        }
      });
    });

    try {
      await queue.waitUntilReady();
      await flow.waitUntilReady();
      await worker.waitUntilReady();

      const tree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        children: [
          { name: 'child-job', data: { idx: 0 }, queueName },
          { name: 'child-job', data: { idx: 1 }, queueName },
        ],
      });

      await completing;
      await worker.close();
      worker = undefined;

      await queue.retryJobs({ state: 'completed' });

      const { processed, unprocessed } = await tree.job.getDependenciesCount({
        processed: true,
        unprocessed: true,
      });
      expect(processed).toBe(0);
      expect(unprocessed).toBe(2);
      // The parent was already released when the last child finished. Retry
      // re-pends the children and does not move the parent back.
      expect(await tree.job.getState()).toBe('waiting');
    } finally {
      await worker?.close();
      await flow.close();
      await queue.close();
    }
  });

  it('moves a failed ignored child back to the parent dependencies', async () => {
    const queueName = `children-${randomUUID()}`;
    const parentQueueName = `parent-${randomUUID()}`;
    const queue = new Queue(queueName, { connection });
    const flow = new FlowProducer({ connection });
    let worker: InstanceType<typeof Worker> | undefined = new Worker(
      queueName,
      async () => {
        throw new Error('error');
      },
      { connection, drainDelay: 1 },
    );
    const failing = new Promise<void>(resolve => {
      worker!.once('failed', () => resolve());
    });

    try {
      await queue.waitUntilReady();
      await flow.waitUntilReady();
      await worker.waitUntilReady();

      const tree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        children: [
          {
            name: 'child-job',
            data: { foo: 'bar' },
            queueName,
            opts: { ignoreDependencyOnFailure: true, attempts: 1 },
          },
        ],
      });

      await failing;
      await worker.close();
      worker = undefined;

      const failedChild = await queue.getJob(tree.children![0].job.id!);
      expect(failedChild?.attemptsMade).toBe(1);

      await queue.retryJobs({ state: 'failed' });

      const retried = await queue.getJob(tree.children![0].job.id!);
      expect(await retried!.getState()).toBe('waiting');
      const { ignored, unprocessed } = await tree.job.getDependenciesCount({
        ignored: true,
        unprocessed: true,
      });
      expect(ignored).toBe(0);
      expect(unprocessed).toBe(1);
      expect(retried?.attemptsMade).toBe(1);
      expect(await tree.job.getState()).toBe('waiting');
    } finally {
      await worker?.close();
      await flow.close();
      await queue.close();
    }
  });
});
