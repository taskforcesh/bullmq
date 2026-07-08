/**
 * Redis-only event tests.
 *
 * These assert on the Redis event stream directly (raw `xlen` / `xrevrange`
 * length checks, `MAXLEN`-based auto-trimming via the `streams.events.maxLen`
 * option, manual `trimEvents`, and `QueueEventsProducer` custom stream events).
 * The event stream and its length-capped trimming are a Redis Streams concept
 * with no portable equivalent (PostgreSQL stores events relationally), so these
 * live in a dedicated Redis-only suite. The backend-agnostic event assertions
 * (which lifecycle events are emitted, and their payloads) run on both backends
 * in `events.test.ts`.
 */
import { getRedisClient } from './utils/get-redis-client';
import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';

import { after } from 'lodash';

import {
  Queue,
  QueueEvents,
  QueueEventsListener,
  QueueEventsProducer,
  Worker,
} from '../src/classes';
import { delay, randomUUID, removeAllQueueData } from '../src/utils';
import { createTestConnection } from './utils/connection-factory';
import { IRedisClient } from '../src/interfaces';

describe('events (redis-only)', () => {
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;

  let connection: IRedisClient;
  beforeAll(async () => {
    connection = createTestConnection();
  });

  beforeEach(async () => {
    queueName = `test-${randomUUID()}`;
    queue = new Queue(queueName, { connection, prefix });
    queueEvents = new QueueEvents(queueName, {
      autorun: false,
      connection,
      prefix,
    });
    await queueEvents.waitUntilReady();
    queueEvents.run();
  });

  afterEach(async () => {
    await queue.close();
    await queueEvents.close();
    await removeAllQueueData(createTestConnection(), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  describe('when jobs removal is attempted on non-existed records', async () => {
    it('should not publish removed events', async () => {
      const numRemovals = 100;
      const trimmedQueue = new Queue(queueName, {
        connection,
        prefix,
      });

      const client = await getRedisClient(trimmedQueue);

      for (let i = 0; i < numRemovals; i++) {
        await trimmedQueue.remove(i.toString());
      }

      const eventsLength = await client.xlen(trimmedQueue.keys.events);

      expect(eventsLength).toEqual(0);

      await trimmedQueue.close();
      await removeAllQueueData(createTestConnection(), queueName);
    });
  });

  describe('when maxLen is 0', () => {
    it('should trim events automatically', async () => {
      const trimmedQueue = new Queue(queueName, {
        connection,
        prefix,
        streams: {
          events: {
            maxLen: 0,
          },
        },
      });

      const worker = new Worker(
        queueName,
        async () => {
          await delay(100);
        },
        { connection, prefix },
      );

      await trimmedQueue.waitUntilReady();
      await worker.waitUntilReady();

      const client = await getRedisClient(trimmedQueue);

      const waitCompletedEvent = new Promise<void>(resolve => {
        queueEvents.on(
          'completed',
          after(3, async () => {
            resolve();
          }),
        );
      });

      await trimmedQueue.addBulk([
        { name: 'test', data: { foo: 'bar' } },
        { name: 'test', data: { foo: 'baz' } },
        { name: 'test', data: { foo: 'bar' } },
      ]);

      await waitCompletedEvent;

      const [[id, [_, drained]], [, [, completed]]] = await client.xrevrange(
        trimmedQueue.keys.events,
        '+',
        '-',
      );

      expect(drained).toBe('drained');
      expect(completed).toBe('completed');

      const eventsLength = await client.xlen(trimmedQueue.keys.events);

      expect(eventsLength).toBeLessThanOrEqual(2);

      await worker.close();
      await trimmedQueue.close();
      await removeAllQueueData(createTestConnection(), queueName);
    });
  });

  describe('when maxLen is greater than 0', () => {
    it('should trim events so its length is at least the threshold', async () => {
      const numJobs = 80;
      const trimmedQueue = new Queue(queueName, {
        connection,
        prefix,
        streams: {
          events: {
            maxLen: 20,
          },
        },
      });

      const worker = new Worker(
        queueName,
        async () => {
          await delay(50);
        },
        { connection, prefix },
      );

      await trimmedQueue.waitUntilReady();
      await worker.waitUntilReady();

      const client = await getRedisClient(trimmedQueue);

      const waitCompletedEvent = new Promise<void>(resolve => {
        queueEvents.on(
          'completed',
          after(numJobs, async () => {
            resolve();
          }),
        );
      });

      const jobs = Array.from(Array(numJobs).keys()).map(() => ({
        name: 'test',
        data: { foo: 'bar' },
      }));

      await trimmedQueue.addBulk(jobs);

      await waitCompletedEvent;

      const eventsLength = await client.xlen(trimmedQueue.keys.events);

      expect(eventsLength).toBeLessThanOrEqual(45);
      expect(eventsLength).toBeGreaterThanOrEqual(20);

      await worker.close();
      await trimmedQueue.close();
      await removeAllQueueData(createTestConnection(), queueName);
    });

    describe('when jobs are moved to delayed', () => {
      it('should trim events so its length is at least the threshold', async () => {
        const numJobs = 80;
        const trimmedQueue = new Queue(queueName, {
          connection,
          prefix,
          streams: {
            events: {
              maxLen: 20,
            },
          },
        });

        const worker = new Worker(
          queueName,
          async () => {
            await delay(50);
            throw new Error('error');
          },
          { connection, prefix },
        );

        await trimmedQueue.waitUntilReady();
        await worker.waitUntilReady();

        const client = await getRedisClient(trimmedQueue);

        const waitDelayedEvent = new Promise<void>(resolve => {
          queueEvents.on(
            'delayed',
            after(numJobs, async () => {
              resolve();
            }),
          );
        });

        const jobs = Array.from(Array(numJobs).keys()).map(() => ({
          name: 'test',
          data: { foo: 'bar' },
          opts: {
            attempts: 2,
            backoff: 5000,
          },
        }));
        await trimmedQueue.addBulk(jobs);

        await waitDelayedEvent;

        const eventsLength = await client.xlen(trimmedQueue.keys.events);

        expect(eventsLength).toBeLessThanOrEqual(35);
        expect(eventsLength).toBeGreaterThanOrEqual(20);

        await worker.close();
        await trimmedQueue.close();
        await removeAllQueueData(createTestConnection(), queueName);
      });
    });

    describe('when jobs are retried immediately', () => {
      it('should trim events so its length is at least the threshold', async () => {
        const numJobs = 80;
        const trimmedQueue = new Queue(queueName, {
          connection,
          prefix,
          streams: {
            events: {
              maxLen: 20,
            },
          },
        });

        const worker = new Worker(
          queueName,
          async () => {
            await delay(25);
            throw new Error('error');
          },
          { connection, prefix },
        );

        await trimmedQueue.waitUntilReady();
        await worker.waitUntilReady();

        const client = await getRedisClient(trimmedQueue);

        const waitCompletedEvent = new Promise<void>((resolve, reject) => {
          queueEvents.on('waiting', async ({ jobId, prev }) => {
            try {
              if (prev) {
                expect(prev).toEqual('active');
                if (jobId === numJobs + '') {
                  resolve();
                }
              }
            } catch (error) {
              reject(error);
            }
          });
        });

        const jobs = Array.from(Array(numJobs).keys()).map(() => ({
          name: 'test',
          data: { foo: 'bar' },
          opts: {
            attempts: 2,
          },
        }));
        await trimmedQueue.addBulk(jobs);

        await waitCompletedEvent;

        const eventsLength = await client.xlen(trimmedQueue.keys.events);

        expect(eventsLength).toBeLessThanOrEqual(35);
        expect(eventsLength).toBeGreaterThanOrEqual(20);

        await worker.close();
        await trimmedQueue.close();
        await removeAllQueueData(createTestConnection(), queueName);
      });
    });

    describe('when jobs removal is attempted', async () => {
      it('should trim events so its length is at least the threshold', async () => {
        const numRemovals = 200;
        const trimmedQueue = new Queue(queueName, {
          connection,
          prefix,
          streams: {
            events: {
              maxLen: 20,
            },
          },
        });

        const client = await getRedisClient(trimmedQueue);

        const jobs = Array.from(Array(numRemovals).keys()).map(() => ({
          name: 'test',
          data: { foo: 'bar' },
        }));
        await trimmedQueue.addBulk(jobs);

        for (let i = 1; i <= numRemovals; i++) {
          await trimmedQueue.remove(i.toString());
        }

        const eventsLength = await client.xlen(trimmedQueue.keys.events);

        expect(eventsLength).toBeLessThanOrEqual(100);
        expect(eventsLength).toBeGreaterThanOrEqual(20);

        await trimmedQueue.close();
        await removeAllQueueData(createTestConnection(), queueName);
      });
    });
  });

  it('should trim events manually', async () => {
    const queueName = 'test-manual-' + randomUUID();
    const trimmedQueue = new Queue(queueName, { connection, prefix });

    await trimmedQueue.add('test', {});
    await trimmedQueue.add('test', {});
    await trimmedQueue.add('test', {});
    await trimmedQueue.add('test', {});

    const client = await getRedisClient(trimmedQueue);

    let eventsLength = await client.xlen(trimmedQueue.keys.events);

    expect(eventsLength).toBe(8);

    await trimmedQueue.trimEvents(0);

    eventsLength = await client.xlen(trimmedQueue.keys.events);

    expect(eventsLength).toBe(0);

    await trimmedQueue.close();
    await removeAllQueueData(createTestConnection(), queueName);
  });

  describe('when publishing custom events', () => {
    it('emits waiting when a job has been added', async () => {
      const queueName2 = `test-${randomUUID()}`;
      const queueEventsProducer = new QueueEventsProducer(queueName2, {
        connection,
        prefix,
      });
      const queueEvents2 = new QueueEvents(queueName2, {
        autorun: false,
        connection,
        prefix,
        lastEventId: '0-0',
      });
      await queueEvents2.waitUntilReady();

      interface CustomListener extends QueueEventsListener {
        example: (args: { custom: string }, id: string) => void;
      }
      const customEvent = new Promise<void>(resolve => {
        queueEvents2.on<CustomListener>('example', async ({ custom }) => {
          await delay(250);
          await expect(custom).toBe('value');
          resolve();
        });
      });

      interface CustomEventPayload {
        eventName: string;
        custom: string;
      }

      await queueEventsProducer.publishEvent<CustomEventPayload>({
        eventName: 'example',
        custom: 'value',
      });

      queueEvents2.run();
      await customEvent;

      await queueEventsProducer.close();
      await queueEvents2.close();
      await removeAllQueueData(createTestConnection(), queueName2);
    });
  });
});
