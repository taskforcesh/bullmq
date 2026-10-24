import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { createPostgresBackend, withBackend } from '../../src';
import { checkReaddedFlow } from '../utils/readded-flow';
import { getPostgresUrl } from './utils/postgres-url';

describe('PostgreSQL re-added flows', () => {
  it('registers concurrent children without upgrading the parent lock', async () => {
    const schema = `flow_${randomUUID().replace(/-/g, '')}`;
    const connection = {
      connectionString: getPostgresUrl(),
      schema,
      migrate: true,
    };
    const { Queue, FlowProducer } = withBackend(createPostgresBackend);
    const queue = new Queue('concurrent', { connection });
    await queue.waitUntilReady();
    const flow = new FlowProducer({ connection });
    const pool = new Pool({ connectionString: getPostgresUrl() });
    const first = await pool.connect();
    const second = await pool.connect();
    let secondAdd: Promise<unknown> | undefined;
    try {
      await flow.add({
        name: 'parent',
        queueName: queue.name,
        opts: { jobId: 'parent' },
        children: [
          { name: 'seed', queueName: queue.name, opts: { jobId: 'seed' } },
        ],
      });
      for (const client of [first, second]) {
        await client.query(`SET search_path TO "${schema}"`);
        await client.query("SET statement_timeout = '5s'");
      }
      const firstPid = (await first.query('SELECT pg_backend_pid() AS pid'))
        .rows[0].pid;
      const secondPid = (await second.query('SELECT pg_backend_pid() AS pid'))
        .rows[0].pid;
      await first.query('BEGIN');
      // Hold the same row lock as an earlier child counter update in add_flow.
      await first.query(
        'UPDATE job SET pending_deps = pending_deps WHERE queue = $1 AND id = $2',
        [queue.qualifiedName, 'parent'],
      );
      const entry = (id: string) =>
        JSON.stringify([
          {
            queue: queue.qualifiedName,
            id,
            name: id,
            parentQueue: queue.qualifiedName,
            parentId: 'parent',
            parentKey: `${queue.qualifiedName}:parent`,
            timestamp: Date.now(),
          },
        ]);
      secondAdd = second.query('SELECT * FROM add_flow($1::jsonb)', [
        entry('second'),
      ]);
      // Observe errors again below, after releasing the first transaction.
      secondAdd.catch(() => {});
      await expect
        .poll(
          async () => {
            const { rows } = await pool.query(
              'SELECT $1 = ANY(pg_blocking_pids($2)) AS blocked',
              [firstPid, secondPid],
            );
            return rows[0].blocked;
          },
          { timeout: 3000, interval: 10 },
        )
        .toBe(true);

      // The second add holds a foreign-key KEY SHARE lock while waiting for
      // the counter update. An upgrade to FOR UPDATE here would deadlock it.
      await first.query('SELECT * FROM add_flow($1::jsonb)', [entry('first')]);
      await first.query('COMMIT');
      await secondAdd;
      const { rows } = await pool.query(
        `SELECT pending_deps, state FROM "${schema}".job
          WHERE queue = $1 AND id = $2`,
        [queue.qualifiedName, 'parent'],
      );
      expect(rows).toEqual([{ pending_deps: 3, state: 'waiting-children' }]);
      expect(await queue.getJob('first')).toBeDefined();
      expect(await queue.getJob('second')).toBeDefined();
    } finally {
      await first.query('ROLLBACK');
      await secondAdd?.catch(() => {});
      first.release();
      second.release();
      await flow.close();
      await queue.close();
      try {
        await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await pool.end();
      }
    }
  });

  it.each([
    [true, false, 'siblings'],
    [false, false, 'siblings'],
    [true, true, 'siblings'],
    [false, true, 'siblings'],
    [true, false, 'nested'],
    [true, true, 'split'],
  ] as const)(
    'registers every sibling before releasing a parent (completedFirst=%s, bulk=%s, structure=%s)',
    async (completedFirst, bulk, structure) => {
      const schema = `flow_${randomUUID().replace(/-/g, '')}`;
      const connection = {
        connectionString: getPostgresUrl(),
        schema,
        migrate: true,
      };
      const { Queue, FlowProducer, Worker } = withBackend(
        createPostgresBackend,
      );
      const queue = new Queue('readded', { connection });
      await queue.waitUntilReady();
      const flow = new FlowProducer({ connection });
      const worker = new Worker('readded', undefined, {
        connection,
        autorun: false,
      });
      const errors: Error[] = [];
      worker.on('error', error => errors.push(error));
      try {
        await checkReaddedFlow(
          queue,
          flow,
          worker,
          completedFirst,
          bulk,
          structure,
        );
        expect(errors).toEqual([]);
      } finally {
        await worker.close();
        await flow.close();
        await queue.close();
        const pool = new Pool({ connectionString: getPostgresUrl() });
        try {
          await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
        } finally {
          await pool.end();
        }
      }
    },
  );
});
