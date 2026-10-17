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
import { runMigrations } from '../../src/postgres';
import { MIGRATIONS } from '../../src/postgres/migrations';
import { delay } from '../../src/utils';
import { getPostgresUrl } from './utils/postgres-url';

describe('PostgreSQL flows (end-to-end)', () => {
  const url = getPostgresUrl();
  const schema = 'bullmq_flow_test';
  let pool: Pool;

  const useSchema = (backendSchema: string, migrate: boolean) =>
    setDefaultBackendFactory((name, opts, options) =>
      createPostgresBackend(
        name,
        {
          ...opts,
          connection: { connectionString: url, schema: backendSchema, migrate },
        },
        options,
      ),
    );

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    useSchema(schema, true);
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

    it('lets a failed parent run when retried after its child is re-added and retried', async () => {
      const queueName = `fq-${randomUUID()}`;
      const queue = new Queue(queueName, { connection: {} });
      let failMon = true;
      let tueProcessed = false;
      const worker = new Worker(
        queueName,
        async (job: Job) => {
          if (job.name === 'mon' && failMon) {
            throw new Error('mon failed');
          }
          if (job.name === 'tue') {
            tueProcessed = true;
          }
        },
        { connection: {}, drainDelay: 1 },
      );
      const flow = new FlowProducer({ connection: {} });
      const flowTree = {
        queueName,
        name: 'tue',
        opts: { jobId: 'tue' },
        children: [
          {
            name: 'mon',
            queueName,
            opts: { jobId: 'mon', failParentOnFailure: true },
          },
        ],
      };
      const finished = (jobId: string) =>
        new Promise<void>(resolve => {
          const onFinished = (job: Job) => {
            if (job.id === jobId) {
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
        const tueFailed = finished('tue');
        await flow.add(flowTree);
        await tueFailed;

        await flow.add(flowTree);

        failMon = false;
        const monCompleted = finished('mon');
        await (await queue.getJob('mon'))!.retry();
        await monCompleted;

        const tueFinished = finished('tue');
        await (await queue.getJob('tue'))!.retry();
        await tueFinished;

        expect(await queue.getJobState('tue')).toBe('completed');
        expect(tueProcessed).toBe(true);
      } finally {
        await worker.close();
        await flow.close();
        await queue.close();
      }
    });
  });

  describe('when a child re-added on schema version 3 is re-added after the upgrade', () => {
    // On schema version 3 a re-added failed child was registered as a pending
    // dependency, leaving its parent in waiting-children. Re-adding it after
    // migrating must settle that row instead of keeping the parent stuck.
    const v3Schema = 'bullmq_flow_v3_test';

    const createSchemaAtVersion3 = async () => {
      await pool.query(`DROP SCHEMA IF EXISTS "${v3Schema}" CASCADE`);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`CREATE SCHEMA "${v3Schema}"`);
        await client.query(`SET LOCAL search_path TO "${v3Schema}"`);
        await client.query(
          `CREATE TABLE migration (
             version integer PRIMARY KEY,
             name text NOT NULL,
             min_client_version integer NOT NULL,
             applied_at timestamptz NOT NULL DEFAULT now()
           )`,
        );
        for (const migration of MIGRATIONS.filter(m => m.version <= 3)) {
          await client.query(migration.load());
          await client.query(
            `INSERT INTO migration (version, name, min_client_version)
             VALUES ($1, $2, $3)`,
            [migration.version, migration.name, migration.minClientVersion],
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    };

    const schemaVersion = async () => {
      const { rows } = await pool.query<{ version: number }>(
        `SELECT MAX(version)::int AS version FROM "${v3Schema}".migration`,
      );
      return rows[0].version;
    };

    const upgrade = async () => {
      const client = await pool.connect();
      try {
        await runMigrations(client, v3Schema);
      } finally {
        client.release();
      }
    };

    const pendingDeps = async (queueName: string) => {
      const { rows } = await pool.query<{ pending_deps: number }>(
        `SELECT pending_deps FROM "${v3Schema}".job
          WHERE queue = $1 AND id = 'tue'`,
        [queueName],
      );
      return rows[0].pending_deps;
    };

    const readdAcrossUpgrade = async (
      childOpts: Record<string, boolean>,
      sibling?: { name: string; queueName: string; opts: object },
    ) => {
      await createSchemaAtVersion3();
      // Clients from before migration 4 run against the version-3 functions.
      useSchema(v3Schema, false);

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
      const readdTree = () => {
        const tree = flowTree();
        if (sibling) {
          tree.children.push({ ...sibling, queueName } as any);
        }
        return tree;
      };

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

        await flow.add(readdTree());
        await delay(500);
        expect(await schemaVersion()).toBe(3);
        expect(await queue.getJobState('tue')).toBe('waiting-children');

        await upgrade();
        expect(await schemaVersion()).toBe(4);

        await flow.add(readdTree());
        await delay(1000);

        return {
          state: await queue.getJobState('tue'),
          pendingDeps: await pendingDeps(queueName),
        };
      } finally {
        await worker.close();
        await flow.close();
        await queue.close();
        useSchema(schema, true);
      }
    };

    it('moves parent to wait when child has ignoreDependencyOnFailure', async () => {
      const { state, pendingDeps } = await readdAcrossUpgrade({
        ignoreDependencyOnFailure: true,
      });

      expect(state).toBe('completed');
      expect(pendingDeps).toBe(0);
    });

    it('moves parent to wait when child has removeDependencyOnFailure', async () => {
      const { state, pendingDeps } = await readdAcrossUpgrade({
        removeDependencyOnFailure: true,
      });

      expect(state).toBe('completed');
      expect(pendingDeps).toBe(0);
    });

    it('moves parent to wait when child has continueParentOnFailure', async () => {
      const { state, pendingDeps } = await readdAcrossUpgrade({
        continueParentOnFailure: true,
      });

      expect(state).toBe('completed');
      expect(pendingDeps).toBe(0);
    });

    it('fails parent when child has failParentOnFailure', async () => {
      const { state, pendingDeps } = await readdAcrossUpgrade({
        failParentOnFailure: true,
      });

      expect(state).toBe('failed');
      expect(pendingDeps).toBe(0);
    });

    it('takes the settled child off the pending count only once', async () => {
      const { state, pendingDeps } = await readdAcrossUpgrade(
        { ignoreDependencyOnFailure: true },
        { name: 'fri', queueName: '', opts: { jobId: 'fri', delay: 60000 } },
      );

      expect(state).toBe('waiting-children');
      expect(pendingDeps).toBe(1);
    });
  });
});
