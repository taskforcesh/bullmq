import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  createPostgresBackend,
  FlowProducer,
  Queue,
  setDefaultBackendFactory,
} from '../../src';
import { getPostgresUrl } from './utils/postgres-url';

/**
 * `Queue.removeJobs` against PostgreSQL: removes the given jobs in a single
 * call and skips the ones that cannot be removed instead of aborting.
 */
describe('PostgreSQL Queue.removeJobs', () => {
  const url = getPostgresUrl();
  const schema = 'bullmq_remove_jobs_test';
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
    setDefaultBackendFactory(); // reset to the Redis default
    await pool.end();
  });

  it('removes the given jobs, ignoring unknown and duplicated ids', async () => {
    const queue = new Queue(`remove-jobs-${randomUUID()}`, { connection: {} });

    try {
      const jobs = await queue.addBulk([
        { name: 'a', data: {} },
        { name: 'b', data: {} },
        { name: 'c', data: {}, opts: { delay: 60000 } },
      ]);
      const events: string[] = [];
      queue.on('removed', (jobId: string) => events.push(jobId));

      const removed = await queue.removeJobs([
        jobs[0].id!,
        'missing',
        jobs[2].id!,
        jobs[0].id!,
      ]);

      expect(removed).toEqual([jobs[0].id, jobs[2].id]);
      expect(events).toEqual([jobs[0].id, jobs[2].id]);
      expect(await queue.getJob(jobs[0].id!)).toBeUndefined();
      expect(await queue.getJob(jobs[2].id!)).toBeUndefined();
      expect(await queue.getJob(jobs[1].id!)).toBeDefined();
      expect(await queue.removeJobs([])).toEqual([]);
    } finally {
      await queue.close();
    }
  });

  it('skips the current iteration of a job scheduler', async () => {
    const queue = new Queue(`remove-jobs-${randomUUID()}`, { connection: {} });

    try {
      await queue.upsertJobScheduler('scheduler', { every: 60000 });
      const [schedulerJob] = await queue.getJobs(['waiting', 'delayed']);
      const job = await queue.add('a', {});

      const removed = await queue.removeJobs([schedulerJob.id!, job.id!]);

      expect(removed).toEqual([job.id]);
      expect(await queue.getJob(schedulerJob.id!)).toBeDefined();
    } finally {
      await queue.close();
    }
  });

  it('skips jobs locked by a worker without aborting the rest', async () => {
    const queueName = `remove-jobs-${randomUUID()}`;
    const queue = new Queue(queueName, { connection: {} });

    try {
      const [locked, free] = await queue.addBulk([
        { name: 'locked', data: {} },
        { name: 'free', data: {} },
      ]);
      await pool.query(
        `UPDATE "${schema}".job
            SET lock_token = 'token', locked_until_ms = $3
          WHERE queue = $1 AND id = $2`,
        [queueName, locked.id, Date.now() + 60000],
      );

      const removed = await queue.removeJobs([locked.id!, free.id!]);

      expect(removed).toEqual([free.id]);
      expect(await queue.getJob(locked.id!)).toBeDefined();
      expect(await queue.getJob(free.id!)).toBeUndefined();
    } finally {
      await queue.close();
    }
  });

  it('removes children unless removeChildren is false', async () => {
    const queueName = `remove-jobs-${randomUUID()}`;
    const queue = new Queue(queueName, { connection: {} });
    const flowProducer = new FlowProducer({ connection: {} });

    try {
      const first = await flowProducer.add({
        name: 'parent',
        queueName,
        children: [{ name: 'child', queueName, data: {} }],
      });
      const second = await flowProducer.add({
        name: 'parent',
        queueName,
        children: [{ name: 'child', queueName, data: {} }],
      });

      expect(await queue.removeJobs([first.job.id!])).toEqual([first.job.id]);
      expect(await queue.getJob(first.children![0].job.id!)).toBeUndefined();

      expect(
        await queue.removeJobs([second.job.id!], { removeChildren: false }),
      ).toEqual([second.job.id]);
      expect(await queue.getJob(second.job.id!)).toBeUndefined();
      expect(await queue.getJob(second.children![0].job.id!)).toBeDefined();
    } finally {
      await flowProducer.close();
      await queue.close();
    }
  });
});
