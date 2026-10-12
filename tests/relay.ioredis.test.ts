import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { default as IORedis } from 'ioredis';
import { randomUUID } from 'crypto';
import { RedisRelayBackend, Relay } from '../src';
import { waitFor } from './utils/relay';

const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
const redisHost = process.env.REDIS_HOST || 'localhost';

describe('Relay on ioredis', () => {
  let admin: IORedis;
  let namespace: string;
  const relays: Relay<any>[] = [];
  const backends: RedisRelayBackend[] = [];

  beforeAll(() => {
    admin = new IORedis(redisHost);
  });

  afterEach(async () => {
    await Promise.all(relays.splice(0).map(relay => relay.close()));
    await Promise.all(backends.splice(0).map(backend => backend.close()));
    const keys = await admin.keys(`${prefix}:relay:${namespace}:*`);
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
    const inboxKey = `${prefix}:relay:${namespace}:inbox:${subscriber.nodeId}`;
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

    const keys = await admin.keys(`${prefix}:relay:${namespace}:*`);
    expect(keys.sort()).toEqual([`${prefix}:relay:${namespace}:mid`]);
  });

  it.each(['endpoints', 'patterns'])(
    'bounds dead-node cleanup across many %s and continues on idle sweeps',
    async shape => {
      namespace = `t-${randomUUID().slice(0, 13)}`;
      const backend = await newBackend();
      const base = `${prefix}:relay:${namespace}`;
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
      expect(await admin.exists(`${base}:inbox:dead`)).toBe(1);
      await admin.del(`${base}:alive:dead`);
      await admin.zadd(`${base}:nodes`, 0, 'dead');

      expect(await backend.sweep(1)).toEqual(['dead']);
      expect(await admin.zscore(`${base}:nodes`, 'dead')).toBeNull();
      expect(await admin.exists(`${base}:inbox:dead`)).toBe(0);
      expect(await backend.heartbeat('dead', 30_000)).toBe(false);
      const remainingKey =
        shape === 'endpoints' ? `${base}:eps:dead` : `${base}:ep:dead:ep`;
      expect(await admin.scard(remainingKey)).toBe(250);
      expect(await admin.smembers(`${base}:cleanup`)).toEqual(['dead']);
      expect(
        await backend.publish('jobs.p0.done', 'after', publishOptions),
      ).toMatchObject({ nodes: 1, endpoints: 1 });
      expect(await admin.exists(`${base}:inbox:dead`)).toBe(0);

      expect(await backend.sweep(1)).toEqual([]);
      expect(await admin.scard(remainingKey)).toBe(150);
      await backend.sweep(1);
      expect(await admin.scard(remainingKey)).toBe(50);
      await backend.sweep(1);
      expect(await admin.exists(`${base}:cleanup`, `${base}:eps:dead`)).toBe(0);
      expect(await admin.keys(`${base}:ep:dead:*`)).toEqual([]);
      expect(await admin.smembers(`${base}:sub:i:jobs`)).toEqual(['jobs.p0.*']);
      expect(await admin.smembers(`${base}:sub:p:jobs.p0.*`)).toEqual([
        'live/live-endpoint',
      ]);
      await backend.unregisterNode('live');
      expect(await admin.keys(`${base}:sub:*`)).toEqual([]);
    },
  );

  it.each(['unregister', 'expired'])(
    'prunes in bounded registration batches before reusing a node ID after %s',
    async removal => {
      namespace = `t-${randomUUID().slice(0, 13)}`;
      const backend = await newBackend();
      const base = `${prefix}:relay:${namespace}`;
      await backend.registerNode('reuse', 30_000);
      await Promise.all(
        Array.from({ length: 350 }, (_, i) =>
          backend.subscribe('reuse', 'same', `old.p${i}.*`),
        ),
      );
      await backend.publish('old.p0.done', 'before', publishOptions);

      if (removal === 'unregister') {
        expect(await backend.unregisterNode('reuse')).toBe(true);
        expect(await admin.scard(`${base}:ep:reuse:same`)).toBe(250);
        expect(await admin.zscore(`${base}:nodes`, 'reuse')).toBeNull();
        expect(
          await admin.exists(`${base}:alive:reuse`, `${base}:inbox:reuse`),
        ).toBe(0);
      } else {
        // Recover without a sweep having removed the expired registration.
        await admin.del(`${base}:alive:reuse`);
        await admin.zadd(`${base}:nodes`, 0, 'reuse');
      }

      // Inspect one script call, before the backend's retry loop activates it.
      expect(
        await (backend as any).exec('relayRegisterNode', ['reuse', 30_000]),
      ).toBe(0);
      expect(await admin.scard(`${base}:ep:reuse:same`)).toBe(
        removal === 'unregister' ? 150 : 250,
      );
      expect(await backend.heartbeat('reuse', 30_000)).toBe(false);
      expect(
        await backend.publish('old.p0.done', 'during', publishOptions),
      ).toMatchObject({ nodes: 0, endpoints: 0 });

      await backend.registerNode('reuse', 30_000);
      expect(
        await admin.exists(`${base}:cleanup`, `${base}:ep:reuse:same`),
      ).toBe(0);
      expect(await admin.keys(`${base}:sub:*`)).toEqual([]);
      expect(await admin.exists(`${base}:inbox:reuse`)).toBe(0);
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
    const base = `${prefix}:relay:${namespace}`;
    for (const node of ['first', 'second']) {
      await backend.registerNode(node, 30_000);
      await Promise.all(
        Array.from({ length: 150 }, (_, i) =>
          backend.subscribe(node, 'ep', `jobs.p${i}.*`),
        ),
      );
      await admin.del(`${base}:alive:${node}`);
      await admin.zadd(`${base}:nodes`, 0, node);
    }

    expect((await backend.sweep(2)).sort()).toEqual(['first', 'second']);
    expect(await admin.zcard(`${base}:nodes`)).toBe(0);
    expect(
      (await admin.scard(`${base}:ep:first:ep`)) +
        (await admin.scard(`${base}:ep:second:ep`)),
    ).toBe(200);
    expect(
      await backend.publish('jobs.p0.done', 'after', publishOptions),
    ).toMatchObject({ nodes: 0, endpoints: 0 });
    for (let i = 0; i < 3; i++) {
      expect(await backend.sweep(2)).toEqual([]);
    }
    expect(await admin.keys(`${base}:*`)).toEqual([`${base}:mid`]);
  });
});
