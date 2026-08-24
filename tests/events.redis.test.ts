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
import { after } from './utils/lodash';
import { EventEmitter } from 'events';
import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';

import {
  Queue,
  QueueEvents,
  QueueEventsListener,
  QueueEventsProducer,
  RedisQueueBackend,
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

  describe('when the blocking XREAD never settles (#4479)', () => {
    it('recovers via the readEvents watchdog', async () => {
      // Reproduce the #4479 wedge for the event-stream consumer: under
      // `maxRetriesPerRequest: null` IORedis silently re-queues and re-sends an
      // interrupted blocking `XREAD` after a reconnect instead of rejecting it,
      // so the awaited read never settles. The watchdog must conclude the read
      // as a timeout, tear the stuck connection down and re-establish it. We
      // drive `readEvents` against a fake client/connection so the
      // never-settling read is deterministic and Redis-independent.
      let disconnected = false;
      let reconnectCalls = 0;

      const fakeClient = {
        status: 'ready',
        xread: () => new Promise(() => {}), // never settles
      };

      const fakeBackend = {
        closing: false,
        connection: {
          // The watchdog resets a live connection by disconnecting it (waiting
          // for the socket to close) and then reconnecting.
          disconnect: async () => {
            disconnected = true;
            fakeClient.status = 'end';
          },
          reconnect: async () => {
            reconnectCalls++;
            fakeClient.status = 'ready';
          },
        },
        queue: {
          client: Promise.resolve(fakeClient),
          keys: { events: `${prefix}:${queueName}:events` },
        },
      };

      // A tiny BLOCK keeps the watchdog window small (~1s).
      const result = await (
        RedisQueueBackend.prototype.readEvents as (
          this: unknown,
          id: string,
          blockTimeout: number,
        ) => Promise<unknown>
      ).call(fakeBackend, '$', 50);

      expect(result).toBe(null);
      // The stuck (live) connection was torn down and re-established.
      expect(disconnected).toBe(true);
      expect(reconnectCalls).toBe(1);
    });
  });

  describe('when the event-stream client is already reconnecting (#4585)', () => {
    it('does not disconnect a reconnecting client, letting IORedis recover', async () => {
      // Reproduce the #4585 wedge for the event-stream consumer: after an
      // outage longer than the block timeout, IORedis is already in
      // "reconnecting" (an armed retry timer but no live socket). Calling
      // `disconnect(false)` here clears that timer without emitting a `close`
      // event, parking the client in "reconnecting" forever. The watchdog must
      // only disconnect a "ready" client and otherwise let IORedis finish its
      // own reconnect; `reconnect()` in the `finally` block then waits for it.
      let disconnectCalls = 0;
      let reconnectCalls = 0;

      const fakeClient = {
        status: 'reconnecting',
        xread: () => new Promise(() => {}), // never settles
      };

      const fakeBackend = {
        closing: false,
        connection: {
          disconnect: async () => {
            disconnectCalls++;
          },
          reconnect: async () => {
            reconnectCalls++;
          },
        },
        queue: {
          client: Promise.resolve(fakeClient),
          keys: { events: `${prefix}:${queueName}:events` },
        },
      };

      const result = await (
        RedisQueueBackend.prototype.readEvents as (
          this: unknown,
          id: string,
          blockTimeout: number,
        ) => Promise<unknown>
      ).call(fakeBackend, '$', 50);

      expect(result).toBe(null);
      // The reconnecting client must be left untouched so its retry timer
      // survives and IORedis can return it to "ready" on its own.
      expect(disconnectCalls).toBe(0);
      expect(reconnectCalls).toBe(1);
    });
  });

  describe('when a healthy event-stream connection is torn down by the watchdog (#4585 ready-path race)', () => {
    it('reconnects instead of racing the disconnect and dying', async () => {
      // Models the second #4585 race for the event-stream consumer: IORedis has
      // self-healed to "ready" before the watchdog fires, so the watchdog tears
      // down a live connection to abandon the unsettled XREAD. IORedis closes
      // the socket asynchronously (`status` stays "ready" for the current
      // microtask run), so a reset that calls `reconnect()` (which early-returns
      // on "ready") before the close lands no-ops, and the pending close then
      // kills the connection. The fake below faithfully models IORedis' async
      // close and the real disconnect(true)/reconnect() contracts.
      const emitter = new EventEmitter();
      let status = 'ready';
      const client = {
        get status() {
          return status;
        },
        xread: () => new Promise(() => {}), // never settles
        disconnect: () => {
          setTimeout(() => {
            status = 'end';
            emitter.emit('end');
          }, 0);
        },
        connect: () => {
          status = 'ready';
          return Promise.resolve();
        },
        once: (ev: string, fn: () => void) => emitter.once(ev, fn),
        removeListener: (ev: string, fn: () => void) =>
          emitter.removeListener(ev, fn),
      };

      const connection = {
        client: Promise.resolve(client),
        disconnect: async (wait = true) => {
          if (status === 'end') {
            return;
          }
          if (!wait) {
            return client.disconnect();
          }
          const ended = new Promise<void>(res => client.once('end', res));
          client.disconnect();
          await ended;
        },
        reconnect: async () => {
          for (;;) {
            if (status === 'ready') {
              return;
            }
            if (status === 'wait' || status === 'end') {
              return client.connect();
            }
            await new Promise(r => setTimeout(r, 5));
          }
        },
      };

      const fakeBackend = {
        closing: false,
        connection,
        queue: {
          client: Promise.resolve(client),
          keys: { events: `${prefix}:${queueName}:events` },
        },
      };

      const result = await (
        RedisQueueBackend.prototype.readEvents as (
          this: unknown,
          id: string,
          blockTimeout: number,
        ) => Promise<unknown>
      ).call(fakeBackend, '$', 50);

      expect(result).toBe(null);
      // Let any pending asynchronous close land.
      await new Promise(r => setTimeout(r, 30));
      // The connection must be healthy again — not left dead by a reconnect()
      // that raced the watchdog's disconnect.
      expect(status).toBe('ready');
    });
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
