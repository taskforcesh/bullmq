import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, it, vi } from 'vitest';
import {
  createPostgresBackend,
  PostgresQueueBackend,
  Queue as BaseQueue,
  Worker as BaseWorker,
  QueueEvents as BaseQueueEvents,
  QueueEventsProducer as BaseQueueEventsProducer,
  FlowProducer as BaseFlowProducer,
  getDefaultBackendFactory,
  withBackend,
} from '../../src';
import { getPostgresUrl } from './utils/postgres-url';

it('binds every constructor to the backend without changing global defaults', async () => {
  const schema = `bound_${randomUUID().replace(/-/g, '')}`;
  const connection = {
    connectionString: getPostgresUrl(),
    schema,
    migrate: true,
  };
  const factory = vi.fn(createPostgresBackend);
  const defaultFactory = getDefaultBackendFactory();
  const { Queue, Worker, QueueEvents, QueueEventsProducer, FlowProducer } =
    withBackend(factory);
  const queue = new Queue<{ value: number }, number>('bound', { connection });
  const errors: Error[] = [];
  queue.on('error', error => errors.push(error));
  // Complete migrations before opening other independently-owned backends.
  await queue.waitUntilReady();
  const worker = new Worker<{ value: number }, number>(
    'bound',
    async job => job.data.value * 2,
    { connection, drainDelay: 1 },
  );
  const events = new QueueEvents<number>('bound', { connection });
  const producer = new QueueEventsProducer('bound', { connection });
  const flow = new FlowProducer({ connection });
  for (const instance of [worker, events, producer, flow]) {
    instance.on('error', error => errors.push(error));
  }

  try {
    expect(queue).toBeInstanceOf(BaseQueue);
    expect(worker).toBeInstanceOf(BaseWorker);
    expect(events).toBeInstanceOf(BaseQueueEvents);
    expect(producer).toBeInstanceOf(BaseQueueEventsProducer);
    expect(flow).toBeInstanceOf(BaseFlowProducer);
    for (const instance of [queue, worker, events, producer, flow]) {
      expect(instance.getBackend()).toBeInstanceOf(PostgresQueueBackend);
    }
    expect(Worker.RateLimitError).toBe(BaseWorker.RateLimitError);
    expect(getDefaultBackendFactory()).toBe(defaultFactory);
    for (const instance of [queue, worker]) {
      const scheduler = await instance.jobScheduler;
      expect(scheduler.getBackend()).toBe(instance.getBackend());
      expect(scheduler.opts.connection).toBe(connection);
      expect(await instance.jobScheduler).toBe(scheduler);
      await scheduler.waitUntilReady();
    }
    expect(factory.mock.calls.map(call => call[2])).toEqual([
      { blocking: false },
      { withBlockingConnection: true },
      { blocking: true },
      { blocking: false },
      undefined,
    ]);

    await events.waitUntilReady();
    await worker.waitUntilReady();
    const job = await queue.add('double', { value: 21 });
    expect(await job.waitUntilFinished(events, 5000)).toBe(42);

    const tree = await flow.add({
      name: 'parent',
      queueName: 'bound',
      data: { value: 3 },
      children: [{ name: 'child', queueName: 'bound', data: { value: 2 } }],
    });
    expect(await tree.job.waitUntilFinished(events, 5000)).toBe(6);

    await producer.publishEvent({ eventName: 'custom', value: 'test' });
    const entries = await producer.getBackend().readEvents('0', 1);
    expect(JSON.stringify(entries)).toContain('custom');
    expect(errors).toEqual([]);
  } finally {
    await worker.close();
    await Promise.all([
      events.close(),
      producer.close(),
      flow.close(),
      queue.close(),
    ]);
    const pool = new Pool({ connectionString: getPostgresUrl() });
    try {
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await pool.end();
    }
  }
});

it('does not release a flow parent after a child attachment fails', async () => {
  const schema = `flow_${randomUUID().replace(/-/g, '')}`;
  const connection = {
    connectionString: getPostgresUrl(),
    schema,
    migrate: true,
  };
  const { Queue, Worker, FlowProducer } = withBackend(createPostgresBackend);
  const completedQueueName = `completed-${randomUUID()}`;
  const flowQueueName = `flow-${randomUUID()}`;
  const queue = new Queue(completedQueueName, { connection });
  let worker: InstanceType<typeof Worker> | undefined;
  const flow = new FlowProducer({ connection });

  try {
    await queue.waitUntilReady();
    await flow.waitUntilReady();

    worker = new Worker(completedQueueName, async () => {}, { connection });
    await worker.waitUntilReady();
    const completed = new Promise<void>(resolve =>
      worker!.once('completed', () => resolve()),
    );
    const completedChildId = `completed-${randomUUID()}`;
    await queue.add('completed-child', {}, { jobId: completedChildId });
    await completed;
    await worker.close();
    worker = undefined;

    await flow.add({
      name: 'source-parent',
      queueName: flowQueueName,
      opts: { jobId: 'source-parent' },
      children: [
        {
          name: 'conflicting-child',
          queueName: flowQueueName,
          opts: { jobId: 'conflicting-child' },
        },
      ],
    });

    const target = await flow.add({
      name: 'target-parent',
      queueName: flowQueueName,
      opts: { jobId: 'target-parent' },
      children: [
        {
          name: 'completed-child',
          queueName: completedQueueName,
          opts: { jobId: completedChildId },
        },
        {
          name: 'conflicting-child',
          queueName: flowQueueName,
          opts: { jobId: 'conflicting-child' },
        },
      ],
    });

    expect(await target.job.getState()).toBe('waiting-children');
    await expect(target.job.getDependenciesCount()).resolves.toMatchObject({
      processed: 1,
      unprocessed: 0,
    });
  } finally {
    await worker?.close();
    await flow.close();
    await queue.close();
    const pool = new Pool({ connectionString: getPostgresUrl() });
    try {
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await pool.end();
    }
  }
});
