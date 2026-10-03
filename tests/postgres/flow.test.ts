import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import {
  createPostgresBackend,
  FlowProducer,
  Job,
  Queue,
  setDefaultBackendFactory,
  WaitingChildrenError,
  Worker,
} from '../../src';
import { delay } from '../../src/utils';
import { getPostgresUrl } from './utils/postgres-url';

describe('PostgreSQL flows (end-to-end)', () => {
  const url = getPostgresUrl();
  const schema = 'bullmq_flow_test';
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    setDefaultBackendFactory((name, opts, options) =>
      createPostgresBackend(
        name,
        {
          ...opts,
          connection: { connectionString: url, schema, migrate: true },
        },
        options,
      ),
    );
  });

  afterAll(async () => {
    setDefaultBackendFactory();
    await pool.end();
  });

  describe('when a child that already failed is re-added with the same parent', () => {
    // The duplicate add does not re-run a failed child, so it must settle the
    // dependency the way the child's failure did instead of waiting on it again.
    const readdAfterChildFailed = async (
      childOpts: Record<string, boolean>,
    ) => {
      const queueName = `fq-${randomUUID()}`;
      const queue = new Queue(queueName, { connection: {} });
      const worker = new Worker(
        queueName,
        async (job: Job) => {
          if (job.name === 'mon') {
            throw new Error('mon failed');
          }
        },
        { connection: {}, drainDelay: 1 },
      );
      const flow = new FlowProducer({ connection: {} });

      const flowTree = (parentOpts: Record<string, boolean> = {}) => ({
        queueName,
        name: 'tue',
        opts: { jobId: 'tue', ...parentOpts },
        children: [
          {
            name: 'mon',
            queueName,
            opts: { jobId: 'mon', ...childOpts },
          },
        ],
      });

      const parentFinished = new Promise<void>(resolve => {
        const onFinished = (job: Job) => {
          if (job.id === 'tue') {
            worker.off('completed', onFinished);
            worker.off('failed', onFinished);
            resolve();
          }
        };
        worker.on('completed', onFinished);
        worker.on('failed', onFinished);
      });

      try {
        await worker.waitUntilReady();
        await flow.add(
          flowTree({ removeOnComplete: true, removeOnFail: true }),
        );
        await parentFinished;

        await flow.add(flowTree());

        await delay(1000);
        return await queue.getJobState('tue');
      } finally {
        await worker.close();
        await flow.close();
        await queue.close();
      }
    };

    it('moves parent to wait when child has ignoreDependencyOnFailure', async () => {
      const state = await readdAfterChildFailed({
        ignoreDependencyOnFailure: true,
      });

      expect(state).toBe('completed');
    });

    it('moves parent to wait when child has removeDependencyOnFailure', async () => {
      const state = await readdAfterChildFailed({
        removeDependencyOnFailure: true,
      });

      expect(state).toBe('completed');
    });

    it('moves parent to wait when child has continueParentOnFailure', async () => {
      const state = await readdAfterChildFailed({
        continueParentOnFailure: true,
      });

      expect(state).toBe('completed');
    });

    it('fails parent when child has failParentOnFailure', async () => {
      const state = await readdAfterChildFailed({
        failParentOnFailure: true,
      });

      expect(state).toBe('failed');
    });

    it('does not block a parent step that re-adds its children', async () => {
      const childQueueName = `fq-${randomUUID()}`;
      const parentQueueName = `fq-${randomUUID()}`;
      const childQueue = new Queue(childQueueName, { connection: {} });
      const parentQueue = new Queue(parentQueueName, { connection: {} });
      const childOpts = {
        jobId: 'mon',
        parent: { id: 'tue', queue: parentQueue.qualifiedName },
        ignoreDependencyOnFailure: true,
      };

      const childWorker = new Worker(
        childQueueName,
        async () => {
          throw new Error('mon failed');
        },
        { connection: {}, drainDelay: 1 },
      );
      let parentWorker: Worker | undefined;

      try {
        await parentQueue.add('tue', {}, { jobId: 'tue' });
        await childQueue.add('mon', {}, childOpts);

        await new Promise(resolve => childWorker.once('failed', resolve));
        await childWorker.close();

        parentWorker = new Worker(
          parentQueueName,
          async (job: Job, token?: string) => {
            // A step that re-runs from the top re-adds every child it adds.
            await childQueue.add('mon', {}, childOpts);
            if (await job.moveToWaitingChildren(token!)) {
              throw new WaitingChildrenError();
            }
          },
          { connection: {}, drainDelay: 1 },
        );

        await delay(1000);
        expect(await parentQueue.getJobState('tue')).toBe('completed');
      } finally {
        await childWorker.close();
        await parentWorker?.close();
        await childQueue.close();
        await parentQueue.close();
      }
    });
  });
});
