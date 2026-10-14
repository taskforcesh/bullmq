import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { default as IORedis } from 'ioredis';
import { randomUUID } from 'crypto';
import { RedisRelayBackend, Relay, RelayError, RelayErrorCode } from '../src';
import { waitFor } from './utils/relay';

const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
const redisHost = process.env.REDIS_HOST || 'localhost';

describe('Relay on ioredis', () => {
  let admin: IORedis;
  let namespace: string;
  const base = () => `${prefix}:relay:{${namespace}}`;
  const relays: Relay<any>[] = [];
  const backends: RedisRelayBackend[] = [];

  beforeAll(() => {
    admin = new IORedis(redisHost);
  });

  afterEach(async () => {
    await Promise.all(relays.splice(0).map(relay => relay.close()));
    await Promise.all(backends.splice(0).map(backend => backend.close()));
    const keys = await admin.keys(`${base()}:*`);
    if (keys.length > 0) {
      await admin.del(...keys);
    }
  });

  afterAll(async () => {
    await admin.quit();
  });

  const newRelay = async () => {
    const relay = new Relay({
      connection: { host: redisHost },
      prefix,
      namespace,
    });
    relays.push(relay);
    await relay.waitUntilReady();
    return relay;
  };

  const newBackend = async () => {
    const backend = new RedisRelayBackend({
      connection: { host: redisHost },
      prefix,
      namespace,
    });
    backends.push(backend);
    await backend.waitUntilReady();
    return backend;
  };

  const publishOptions = {
    ts: 1,
    retainMs: 0,
    maxSize: 1024,
  };

  it('accepts an existing client with default retry options without owning it', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    expect(admin.options.maxRetriesPerRequest).toBe(20);
    const relay = new Relay({ connection: admin, prefix, namespace });
    relays.push(relay);
    await relay.waitUntilReady();
    const received: unknown[] = [];
    await relay.subscribe('a', message => {
      received.push(message.data);
    });
    await relay.publish('a', 'hello');
    await waitFor(() => received.length === 1);
    expect(received).toEqual(['hello']);
    await relay.close();
    expect(admin.options.maxRetriesPerRequest).toBe(20);
    expect(await admin.ping()).toBe('PONG');
  });

  it('delivers messages published while its inbox connection was dropped', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    const subscriber = await newRelay();
    const publisher = await newRelay();
    const received: unknown[] = [];
    subscriber.on('error', () => undefined);
    await subscriber.subscribe('jobs.*.cancel', message => {
      received.push(message.data);
    });

    // Kill every connection currently blocked reading this namespace's inboxes,
    // as a network failure would.
    const inboxKey = `${base()}:inbox:${subscriber.nodeId}`;
    await waitFor(async () => {
      const clients = (await admin.client('LIST')) as string;
      return clients.includes('cmd=xread');
    });
    const clients = ((await admin.client('LIST')) as string)
      .split('\n')
      .filter(line => line.includes('cmd=xread'));
    for (const line of clients) {
      const id = /id=(\d+)/.exec(line)![1];
      await admin.client('KILL', 'ID', id);
    }

    // Published while the reader is reconnecting: kept in the inbox stream.
    for (let i = 0; i < 3; i++) {
      await publisher.publish(`jobs.${i}.cancel`, i);
    }
    expect(await admin.xlen(inboxKey)).toBe(3);

    await waitFor(() => received.length === 3, 8000);
    expect(received).toEqual([0, 1, 2]);
  });

  it('leaves no keys behind when nodes close', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    const relay = await newRelay();
    await relay.subscribe('a.*', () => undefined);
    await relay.subscribe('b.>', () => undefined);
    await relay.publish('a.1', 'x');
    await relay.close();

    expect(await admin.keys(`${base()}:*`)).toEqual([]);
  });

  it('keeps an expiry on every key', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    const subscriber = await newRelay();
    const publisher = await newRelay();
    await subscriber.subscribe('a.*', () => undefined);
    await subscriber.subscribe('a.b', () => undefined);
    await publisher.publish('a.b', 'x', { retain: 60_000 });
    await publisher.publish('a.c', 'y');

    const keys = await admin.keys(`${base()}:*`);
    expect(keys.map(key => key.slice(base().length)).sort()).toEqual(
      [
        `:inbox:${subscriber.nodeId}`,
        ':meta',
        ':mid',
        `:node:${publisher.nodeId}`,
        `:node:${subscriber.nodeId}`,
        ':nodes',
        ':ret:a.b',
        ':retained',
        ':started',
        ':subs',
      ].sort(),
    );
    for (const key of [...keys, `${prefix}:relay:namespaces`]) {
      expect(await admin.pttl(key), key).toBeGreaterThan(0);
    }
    // Retained messages outlive the nodes, and so do the message ids.
    expect(await admin.pttl(`${base()}:mid`)).toBeGreaterThan(30_000);
  });

  it('opens its blocking connection only to read an inbox', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    const backend = await newBackend();
    await backend.registerNode('n1', 30_000);
    await backend.subscribe('n1', 'e1', 'a');
    await backend.publish('a', '1', publishOptions);
    // A dashboard only needs the getters.
    expect(await backend.getCounts()).toMatchObject({ nodes: 1 });
    expect(await backend.getNodes(0, -1)).toHaveLength(1);
    expect((backend as any).blockingConnection).toBeUndefined();

    const { entries } = await backend.readInbox('n1', '0-0', {
      blockMs: 0,
      count: 10,
    });
    expect(entries).toHaveLength(1);
    expect((backend as any).blockingConnection).toBeDefined();
  });

  it('returns at once from inbox reads after an interrupt', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    const backend = await newBackend();
    await backend.registerNode('n1', 30_000);
    backend.interruptInbox();
    const start = Date.now();
    expect(
      await backend.readInbox('n1', '0-0', { blockMs: 5_000, count: 10 }),
    ).toEqual({ entries: [], cursor: '0-0' });
    expect(Date.now() - start).toBeLessThan(1_000);
    expect((backend as any).blockingConnection).toBeUndefined();
  });

  it('refuses to share a namespace with nodes of another layout version', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    const backend = await newBackend();
    await backend.registerNode('n1', 30_000);
    expect(await admin.hget(`${base()}:meta`, 'layout')).toBe('1');
    await admin.hset(`${base()}:meta`, 'layout', '2');
    const error = await backend.registerNode('n2', 30_000).catch(err => err);
    expect(error).toBeInstanceOf(RelayError);
    expect(error.code).toBe(RelayErrorCode.IncompatibleLayout);
  });

  it('requires Redis 6.2', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    const backend = await newBackend();
    const connection = (backend as any).connection;
    const version = connection.version;
    try {
      connection.version = '6.0.20';
      await expect(backend.waitUntilReady()).rejects.toThrow(
        'The relay requires Redis 6.2.0 or newer',
      );
      connection.version = '6.2.0';
      await expect(backend.waitUntilReady()).resolves.toBeUndefined();
    } finally {
      connection.version = version;
    }
  });

  // Marks a node dead as if its process vanished: its record expired.
  const kill = async (node: string) => {
    await admin.del(`${base()}:node:${node}`);
    await admin.zadd(`${base()}:nodes`, 0, node);
  };
  const subscriptionsOf = async (node: string) =>
    (
      await admin.zrangebylex(
        `${base()}:subs`,
        `[n|${node}|`,
        `[n|${node}|\xff`,
      )
    ).length;

  it.each(['endpoints', 'patterns'])(
    'bounds dead-node cleanup across many %s and continues on idle sweeps',
    async shape => {
      namespace = `t-${randomUUID().slice(0, 13)}`;
      const backend = await newBackend();
      await backend.registerNode('dead', 30_000);
      await backend.registerNode('live', 30_000);
      await backend.subscribe('live', 'live-endpoint', 'jobs.p0.*');
      await Promise.all(
        Array.from({ length: 350 }, (_, i) =>
          backend.subscribe(
            'dead',
            shape === 'endpoints' ? `ep${i}` : 'ep',
            shape === 'endpoints' ? 'jobs.p0.*' : `jobs.p${i}.*`,
          ),
        ),
      );
      await backend.publish('jobs.p0.done', 'before', publishOptions);
      expect(await admin.exists(`${base()}:inbox:dead`)).toBe(1);
      await kill('dead');

      expect(await backend.sweep(1)).toEqual(['dead']);
      expect(await admin.zscore(`${base()}:nodes`, 'dead')).toBeNull();
      expect(await admin.exists(`${base()}:inbox:dead`)).toBe(0);
      expect(await backend.heartbeat('dead', 30_000)).toBe(false);
      expect(await subscriptionsOf('dead')).toBe(250);
      expect(await admin.zrange(`${base()}:cleanup`, 0, -1)).toEqual(['dead']);
      expect(
        await backend.publish('jobs.p0.done', 'after', publishOptions),
      ).toMatchObject({ nodes: 1, endpoints: 1 });
      expect(await admin.exists(`${base()}:inbox:dead`)).toBe(0);

      expect(await backend.sweep(1)).toEqual([]);
      expect(await subscriptionsOf('dead')).toBe(150);
      await backend.sweep(1);
      expect(await subscriptionsOf('dead')).toBe(50);
      await backend.sweep(1);
      expect(await admin.exists(`${base()}:cleanup`)).toBe(0);
      expect((await admin.zrange(`${base()}:subs`, 0, -1)).sort()).toEqual([
        'n|live|live-endpoint|jobs.p0.*',
        'p|jobs.p0.*|live|live-endpoint',
        't|jobs.p0.*',
        'w|jobs|jobs.p0.*',
      ]);
      await backend.unregisterNode('live');
      expect(await admin.keys(`${base()}:*`)).toEqual([]);
    },
  );

  it.each(['unregister', 'expired'])(
    'prunes in bounded registration batches before reusing a node ID after %s',
    async removal => {
      namespace = `t-${randomUUID().slice(0, 13)}`;
      const backend = await newBackend();
      // Keeps the namespace alive: without live nodes it is dropped at once.
      await backend.registerNode('anchor', 30_000);
      await backend.registerNode('reuse', 30_000);
      await Promise.all(
        Array.from({ length: 350 }, (_, i) =>
          backend.subscribe('reuse', 'same', `old.p${i}.*`),
        ),
      );
      await backend.publish('old.p0.done', 'before', publishOptions);

      if (removal === 'unregister') {
        expect(await backend.unregisterNode('reuse')).toBe(true);
        expect(await subscriptionsOf('reuse')).toBe(250);
        expect(await admin.zscore(`${base()}:nodes`, 'reuse')).toBeNull();
        expect(
          await admin.exists(`${base()}:node:reuse`, `${base()}:inbox:reuse`),
        ).toBe(0);
      } else {
        // Recover without a sweep having removed the expired registration.
        await kill('reuse');
      }

      // Inspect one script call, before the backend's retry loop activates it.
      expect(
        await (backend as any).exec('relayRegisterNode', [
          'reuse',
          30_000,
          '{}',
          '1',
        ]),
      ).toBe(0);
      expect(await subscriptionsOf('reuse')).toBe(
        removal === 'unregister' ? 150 : 250,
      );
      expect(await backend.heartbeat('reuse', 30_000)).toBe(false);
      expect(
        await backend.publish('old.p0.done', 'during', publishOptions),
      ).toMatchObject({ nodes: 0, endpoints: 0 });

      await backend.registerNode('reuse', 30_000);
      expect(await admin.exists(`${base()}:cleanup`)).toBe(0);
      expect(await subscriptionsOf('reuse')).toBe(0);
      expect(await admin.zcard(`${base()}:subs`)).toBe(0);
      expect(await admin.exists(`${base()}:inbox:reuse`)).toBe(0);
      expect(
        await backend.publish('old.p0.done', 'stale', publishOptions),
      ).toMatchObject({ nodes: 0, endpoints: 0 });
      expect(
        await backend.subscribe('reuse', 'same', 'old.p0.*'),
      ).toMatchObject({
        added: true,
      });
      await backend.registerNode('reuse', 30_000);
      expect(await backend.sweep(100)).toEqual([]);
      expect(
        await backend.publish('old.p0.done', 'fresh', publishOptions),
      ).toMatchObject({ nodes: 1, endpoints: 1 });
      expect(
        (await backend.readInbox('reuse', '0-0', { blockMs: 0, count: 10 }))
          .entries,
      ).toMatchObject([{ data: 'fresh', endpoints: ['same'] }]);
    },
  );

  it('shares the pruning budget across all nodes removed by a sweep', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    const backend = await newBackend();
    await backend.registerNode('anchor', 30_000);
    for (const node of ['first', 'second']) {
      await backend.registerNode(node, 30_000);
      await Promise.all(
        Array.from({ length: 150 }, (_, i) =>
          backend.subscribe(node, 'ep', `jobs.p${i}.*`),
        ),
      );
      await kill(node);
    }

    expect((await backend.sweep(2)).sort()).toEqual(['first', 'second']);
    expect(await admin.zrange(`${base()}:nodes`, 0, -1)).toEqual(['anchor']);
    expect(
      (await subscriptionsOf('first')) + (await subscriptionsOf('second')),
    ).toBe(200);
    expect(
      await backend.publish('jobs.p0.done', 'after', publishOptions),
    ).toMatchObject({ nodes: 0, endpoints: 0 });
    for (let i = 0; i < 3; i++) {
      expect(await backend.sweep(2)).toEqual([]);
    }
    expect(await admin.zcard(`${base()}:subs`)).toBe(0);
    expect(await admin.exists(`${base()}:cleanup`)).toBe(0);
  });

  it('drops a namespace at once when its last live node leaves', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    const backend = await newBackend();
    await backend.registerNode('dead', 30_000);
    await backend.registerNode('last', 30_000);
    await Promise.all(
      Array.from({ length: 500 }, (_, i) =>
        backend.subscribe('dead', 'ep', `jobs.p${i}.*`),
      ),
    );
    await kill('dead');
    expect(await backend.unregisterNode('last')).toBe(true);
    // No live node: every subscription left belongs to dead nodes.
    expect(await admin.keys(`${base()}:*`)).toEqual([]);
  });
});
