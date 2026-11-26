import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPostgresBackend, Job, withBackend } from '../../src';
import { getPostgresUrl } from './utils/postgres-url';

describe('PostgreSQL flows', () => {
  const schema = `flow_${randomUUID().replace(/-/g, '')}`;
  const connection = {
    connectionString: getPostgresUrl(),
    schema,
    migrate: true,
  };
  const { Queue, Worker, FlowProducer } = withBackend(createPostgresBackend);

  beforeAll(async () => {
    // Apply the migrations once, before the tests open their own backends.
    const queue = new Queue(`migrate-${randomUUID()}`, { connection });
    try {
      await queue.waitUntilReady();
    } finally {
      await queue.close();
    }
  });

  afterAll(async () => {
    const pool = new Pool({ connectionString: getPostgresUrl() });
    try {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await pool.end();
    }
  });

  describe('removeUnprocessedChildren', () => {
    it('moves the parent to wait once its last pending child is removed', async () => {
      const parentQueueName = `parent-${randomUUID()}`;
      const childQueueName = `child-${randomUUID()}`;
      const childQueue = new Queue(childQueueName, { connection });
      const flow = new FlowProducer({ connection });

      try {
        const tree = await flow.add({
          name: 'parent',
          queueName: parentQueueName,
          children: [
            { name: 'child', queueName: childQueueName },
            {
              name: 'child',
              queueName: childQueueName,
              children: [{ name: 'grandchild', queueName: childQueueName }],
            },
          ],
        });
        const grandchild = tree.children![1].children![0].job;
        expect(await tree.job.getState()).toBe('waiting-children');

        await tree.job.removeUnprocessedChildren();

        expect(await tree.job.getState()).toBe('waiting');
        expect(await tree.job.getDependenciesCount()).toMatchObject({
          processed: 0,
          unprocessed: 0,
        });
        expect(await tree.job.getDependencies()).toMatchObject({
          unprocessed: [],
        });
        for (const child of [...tree.children!.map(c => c.job), grandchild]) {
          expect(await childQueue.getJob(child.id!)).toBeUndefined();
        }
      } finally {
        await flow.close();
        await childQueue.close();
      }
    });

    it('keeps the values of children that already completed', async () => {
      const parentQueueName = `parent-${randomUUID()}`;
      const doneQueueName = `done-${randomUUID()}`;
      const idleQueueName = `idle-${randomUUID()}`;
      const flow = new FlowProducer({ connection });
      const worker = new Worker(doneQueueName, async () => 'done', {
        connection,
      });

      try {
        const completed = new Promise<void>(resolve =>
          worker.once('completed', () => resolve()),
        );
        const tree = await flow.add({
          name: 'parent',
          queueName: parentQueueName,
          children: [
            { name: 'done', queueName: doneQueueName },
            { name: 'idle', queueName: idleQueueName },
          ],
        });
        await completed;
        expect(await tree.job.getState()).toBe('waiting-children');

        await tree.job.removeUnprocessedChildren();

        expect(await tree.job.getState()).toBe('waiting');
        expect(await tree.job.getDependenciesCount()).toMatchObject({
          processed: 1,
          unprocessed: 0,
        });
        expect(Object.values(await tree.job.getChildrenValues())).toEqual([
          'done',
        ]);
      } finally {
        await worker.close();
        await flow.close();
      }
    });

    it('waits for a child that is still active before moving the parent', async () => {
      const parentQueueName = `parent-${randomUUID()}`;
      const childQueueName = `child-${randomUUID()}`;
      const flow = new FlowProducer({ connection });
      let release!: () => void;
      const released = new Promise<void>(resolve => {
        release = resolve;
      });
      let started!: (job: Job) => void;
      const activeChild = new Promise<Job>(resolve => {
        started = resolve;
      });
      const worker = new Worker(
        childQueueName,
        async job => {
          started(job);
          await released;
        },
        { connection, autorun: false },
      );

      try {
        const tree = await flow.add({
          name: 'parent',
          queueName: parentQueueName,
          children: [
            { name: 'child', queueName: childQueueName },
            { name: 'child', queueName: childQueueName },
          ],
        });
        worker.run();
        const active = await activeChild;
        const completed = new Promise<void>(resolve =>
          worker.once('completed', () => resolve()),
        );

        await tree.job.removeUnprocessedChildren();

        expect(await tree.job.getState()).toBe('waiting-children');
        expect(await tree.job.getDependenciesCount()).toMatchObject({
          processed: 0,
          unprocessed: 1,
        });

        release();
        await completed;

        expect(await active.getState()).toBe('completed');
        expect(await tree.job.getState()).toBe('waiting');
        expect(await tree.job.getDependenciesCount()).toMatchObject({
          processed: 1,
          unprocessed: 0,
        });
      } finally {
        release();
        await worker.close();
        await flow.close();
      }
    });

    it('skips a child that a worker takes while the children are being removed', async () => {
      const parentQueueName = `parent-${randomUUID()}`;
      const childQueueName = `child-${randomUUID()}`;
      const flow = new FlowProducer({ connection });
      const pool = new Pool({ connectionString: getPostgresUrl() });
      const taker = await pool.connect();
      const remover = await pool.connect();

      try {
        const tree = await flow.add({
          name: 'parent',
          queueName: parentQueueName,
          children: [{ name: 'child', queueName: childQueueName }],
        });
        const child = tree.children![0].job;
        const pids: number[] = [];
        for (const client of [taker, remover]) {
          await client.query(`SET search_path TO "${schema}"`);
          const { rows } = await client.query<{ pid: number }>(
            'SELECT pg_backend_pid() AS pid',
          );
          pids.push(rows[0].pid);
        }

        // A worker takes the child but hasn't committed yet.
        await taker.query('BEGIN');
        const { rows: taken } = await taker.query<{ id: string }>(
          'SELECT * FROM move_to_active($1, $2, 30000, $3, NULL, NULL, NULL)',
          [childQueueName, randomUUID(), Date.now()],
        );
        expect(taken.map(job => job.id)).toEqual([child.id]);

        // The removal still sees the child as waiting, so it waits for the
        // child's row until the worker commits.
        const removing = remover.query(
          'SELECT remove_unprocessed_children($1, $2)',
          [parentQueueName, tree.job.id],
        );
        await vi.waitFor(async () => {
          const { rows } = await pool.query<{ blockers: number[] }>(
            'SELECT pg_blocking_pids($1) AS blockers',
            [pids[1]],
          );
          expect(rows[0].blockers).toContain(pids[0]);
        });
        await taker.query('COMMIT');
        await removing;

        expect(await child.getState()).toBe('active');
        expect(await tree.job.getState()).toBe('waiting-children');
        expect(await tree.job.getDependenciesCount()).toMatchObject({
          processed: 0,
          unprocessed: 1,
        });
      } finally {
        await taker.query('ROLLBACK');
        taker.release();
        remover.release();
        await pool.end();
        await flow.close();
      }
    });
  });
});
