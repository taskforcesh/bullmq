import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  createPostgresBackend,
  FlowProducer,
  PostgresConnection,
  Queue,
  QueueEvents,
  Worker,
} from '../../src';
import { delay } from '../../src/utils';
import { getPostgresUrl } from './utils/postgres-url';

/**
 * Queues, Workers and QueueEvents sharing one {@link PostgresConnection}: one
 * pool and one `LISTEN` client for all of them, whatever their queues.
 */
describe('PostgreSQL shared connection', () => {
  const url = getPostgresUrl();
  const schema = 'bullmq_shared_connection_test';
  let admin: Pool;

  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  });

  afterAll(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  });

  const newQueueNames = (count: number) =>
    Array.from({ length: count }, () => `sq-${randomUUID()}`);

  const newConnection = (applicationName = 'bullmq-shared-test', max = 4) =>
    new PostgresConnection({
      connectionString: url,
      schema,
      migrate: true,
      max,
      application_name: applicationName,
    });

  const countConnections = async (applicationName: string) => {
    const { rows } = await admin.query(
      'SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1',
      [applicationName],
    );
    return rows[0].n as number;
  };

  /**
   * Starts one Worker per queue name on `connection` and waits until they all
   * block. They block for a minute, far longer than any test waits, so only a
   * NOTIFY on the shared LISTEN client can wake them in time.
   */
  const startWorkers = async (
    connection: PostgresConnection,
    queueNames: string[],
  ) => {
    const processed = queueNames.map(() => 0);
    const workers = queueNames.map(
      (name, i) =>
        new Worker(
          name,
          async () => {
            processed[i]++;
          },
          { connection, drainDelay: 60 },
          createPostgresBackend,
        ),
    );
    await Promise.all(workers.map(worker => worker.waitUntilReady()));
    await delay(200);
    return { workers, processed };
  };

  const addJobs = async (connection: PostgresConnection, names: string[]) => {
    for (const name of names) {
      const queue = new Queue(name, { connection }, createPostgresBackend);
      await queue.add('job', {});
      await queue.close();
    }
  };

  const waitFor = async (condition: () => boolean) => {
    const deadline = Date.now() + 10_000;
    while (!condition()) {
      if (Date.now() > deadline) {
        throw new Error('Timed out');
      }
      await delay(20);
    }
  };

  it('runs Workers on many queues over one pool and one LISTEN connection', async () => {
    const applicationName = `bullmq-shared-${randomUUID().slice(0, 8)}`;
    const connection = newConnection(applicationName);
    const queueNames = newQueueNames(20);
    const { workers, processed } = await startWorkers(connection, queueNames);

    await addJobs(connection, queueNames);
    await waitFor(() => processed.every(count => count === 1));

    // The pool (`max: 4`) plus one LISTEN connection, for 20 Workers.
    expect(await countConnections(applicationName)).toBeLessThanOrEqual(5);

    await Promise.all(workers.map(worker => worker.close()));
    await connection.close();
    expect(await countConnections(applicationName)).toBe(0);
  });

  it('gives a job to one of the Workers waiting on its queue', async () => {
    const connection = newConnection();
    const [name] = newQueueNames(1);
    const { workers, processed } = await startWorkers(connection, [name, name]);

    await addJobs(connection, [name]);
    await waitFor(() => processed[0] + processed[1] === 1);
    await delay(200);
    expect(processed[0] + processed[1]).toBe(1);

    await Promise.all(workers.map(worker => worker.close()));
    await connection.close();
  });

  it('wakes its Workers again after the LISTEN connection drops', async () => {
    const applicationName = `bullmq-shared-${randomUUID().slice(0, 8)}`;
    const connection = newConnection(applicationName);
    const queueNames = newQueueNames(5);
    const { workers, processed } = await startWorkers(connection, queueNames);

    const { rowCount } = await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE application_name = $1 AND query LIKE '%LISTEN bullmq_jobs%'`,
      [applicationName],
    );
    expect(rowCount).toBe(1);
    // Let the Workers rebuild the LISTEN client and wait again.
    await delay(500);

    await addJobs(connection, queueNames);
    await waitFor(() => processed.every(count => count === 1));

    await Promise.all(workers.map(worker => worker.close()));
    await connection.close();
  });

  it('runs many Workers on a one-connection pool', async () => {
    // Every query of the 10 Workers goes through the pool's one connection;
    // the LISTEN client is separate.
    const connection = newConnection(undefined, 1);
    const queueNames = newQueueNames(10);
    const { workers, processed } = await startWorkers(connection, queueNames);

    await addJobs(connection, queueNames);
    await waitFor(() => processed.every(count => count === 1));

    await Promise.all(workers.map(worker => worker.close()));
    await connection.close();
  });

  it('stays open, without their listeners, once its Workers close', async () => {
    const connection = newConnection();
    const before = connection.listenerCount('error');
    const { workers } = await startWorkers(connection, newQueueNames(2));
    expect(connection.listenerCount('error')).toBe(before + 2);

    await Promise.all(workers.map(worker => worker.close()));
    expect(connection.listenerCount('error')).toBe(before);
    // No wait is left listening for its queue's notifications.
    expect(
      connection
        .eventNames()
        .filter(name => String(name).startsWith('bullmq_')),
    ).toEqual([]);
    expect(connection.isClosing).toBeUndefined();

    // New Queues and Workers can still use it.
    const names = newQueueNames(1);
    const { workers: next, processed } = await startWorkers(connection, names);
    await addJobs(connection, names);
    await waitFor(() => processed[0] === 1);

    await next[0].close();
    await connection.close();
  });

  it('adds no listeners for the queues of a flow', async () => {
    const connection = newConnection();
    const flow = new FlowProducer({ connection }, createPostgresBackend);
    const before = connection.listenerCount('error');

    const [parent, child] = newQueueNames(2);
    await flow.add({
      name: 'parent',
      queueName: parent,
      children: [{ name: 'child', queueName: child }],
    });
    expect(connection.listenerCount('error')).toBe(before);

    await flow.close();
    await connection.close();
  });

  it('delivers QueueEvents over the shared LISTEN connection', async () => {
    const applicationName = `bullmq-shared-${randomUUID().slice(0, 8)}`;
    const connection = newConnection(applicationName);
    const [name] = newQueueNames(1);
    const events = new QueueEvents(
      name,
      // Like the Workers, it blocks for a minute: only a NOTIFY delivers in time.
      { connection, blockingTimeout: 60_000 },
      createPostgresBackend,
    );
    const completed: unknown[] = [];
    events.on('completed', ({ returnvalue }) => completed.push(returnvalue));
    await events.waitUntilReady();
    const { workers } = await startWorkers(connection, [name]);

    await addJobs(connection, [name]);
    await waitFor(() => completed.length === 1);
    expect(await countConnections(applicationName)).toBeLessThanOrEqual(5);

    // After the LISTEN connection drops, events arrive again.
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE application_name = $1 AND query LIKE '%LISTEN bullmq_%'`,
      [applicationName],
    );
    await delay(500);
    await addJobs(connection, [name]);
    await waitFor(() => completed.length === 2);

    // Closing it leaves the connection open for the Worker.
    const before = connection.listenerCount('error');
    await events.close();
    expect(connection.listenerCount('error')).toBe(before - 1);
    expect(connection.isClosing).toBeUndefined();

    await workers[0].close();
    await connection.close();
  });
});
