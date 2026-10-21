import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { default as IORedis } from 'ioredis';
import { randomUUID } from 'crypto';
import { AddressInfo, createServer, Socket } from 'net';
import {
  Queue,
  RedisConnection,
  RedisRelayBackend,
  Relay,
  RelayError,
  RelayErrorCode,
} from '../src';
import { waitFor } from './utils/relay';

const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
const redisHost = process.env.REDIS_HOST || 'localhost';

describe('Relay on ioredis', () => {
  let admin: IORedis;
  let namespace: string;
  const base = () => `${prefix}::relay:{${namespace}}`;
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

  it('forwards errors from both Redis connections through Relay', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    const relay = await newRelay();
    const errors: Error[] = [];
    relay.on('error', error => errors.push(error));
    const backend = (relay as any).backend as RedisRelayBackend;
    await waitFor(() => !!(backend as any).blockingConnection);

    const commandError = new Error('command connection failed');
    const blockingError = new Error('blocking connection failed');
    (backend as any).connection.emit('error', commandError);
    (backend as any).blockingConnection.emit('error', blockingError);

    expect(errors).toEqual([commandError, blockingError]);
  });

  it('keeps namespace registry retries off the publish path', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    const backend = await newBackend();
    const client = await (backend as any).connection.client;
    const runCommand = client.runCommand.bind(client);
    const registryError = new Error('registry refresh failed');
    const errors: Error[] = [];
    let attempts = 0;
    backend.on('error', error => errors.push(error));
    client.runCommand = vi.fn(async (command, args) => {
      if (
        typeof command === 'string' &&
        command.startsWith('relayTouchNamespace:')
      ) {
        attempts++;
        throw registryError;
      }
      return runCommand(command, args);
    });

    await expect(
      backend.publish('a', '"message"', {
        ...publishOptions,
        retainMs: 1_000,
      }),
    ).resolves.toMatchObject({ nodes: 0, endpoints: 0 });

    await waitFor(() => attempts === 3);
    expect(errors).toEqual([registryError]);
  });

  it('uses each recipient inbox limit and counts only unread publish-time drops', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    const backend = await newBackend();
    await backend.registerNode('small', 30_000, {}, 2);
    await backend.registerNode('large', 30_000, {}, 10);
    await backend.subscribe('small', 'e1', 'a');
    await backend.subscribe('large', 'e2', 'a');

    for (let i = 0; i < 5; i++) {
      await backend.publish('a', String(i), publishOptions);
    }

    const smallInbox = `${base()}:small:inbox`;
    const largeInbox = `${base()}:large:inbox`;
    expect(await admin.xlen(smallInbox)).toBe(2);
    expect(await admin.xlen(largeInbox)).toBe(5);
    expect(
      Object.fromEntries(
        (await backend.getNodes(0, -1)).map(node => [node.id, node.dropped]),
      ),
    ).toEqual({ large: 0, small: 3 });

    const consumed = await backend.readInbox('small', '0-0', {
      blockMs: 0,
      count: 10,
    });
    await backend.readInbox('small', consumed.cursor, {
      blockMs: 0,
      count: 10,
    });
    await backend.publish('a', 'consumed', publishOptions);
    expect(
      Object.fromEntries(
        (await backend.getNodes(0, -1)).map(node => [node.id, node.dropped]),
      ),
    ).toEqual({ large: 0, small: 3 });
    expect(await admin.xlen(smallInbox)).toBe(2);
  });

  it('isolates connection discovery for matching node identifiers in different databases', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    const nodes = [0, 1].map(db => {
      const relay = new Relay({
        connection: { host: redisHost, db },
        prefix,
        namespace,
        nodeId: 'same-node',
      });
      relays.push(relay);
      return relay;
    });
    await Promise.all(nodes.map(node => node.waitUntilReady()));
    await vi.waitFor(async () => {
      const connections = await Promise.all(
        nodes.map(node => node.getNodeConnections(node.nodeId)),
      );
      expect(connections.map(list => list.length)).toEqual([1, 1]);
      expect(connections[0][0].address).not.toBe(connections[1][0].address);
    });
  });

  it('does not count a fetched batch as dropped while awaiting its heartbeat', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    const backend = await newBackend();
    let fetched = false;
    let held = false;
    let release!: () => void;
    const released = new Promise<void>(resolve => {
      release = resolve;
    });
    const readInbox = backend.readInbox.bind(backend);
    vi.spyOn(backend, 'readInbox').mockImplementation(async (...args) => {
      const batch = await readInbox(...args);
      fetched ||= batch.entries.length > 0;
      return batch;
    });
    const heartbeat = backend.heartbeat.bind(backend);
    vi.spyOn(backend, 'heartbeat').mockImplementation(async (...args) => {
      if (fetched && !held) {
        held = true;
        await released;
      }
      return heartbeat(...args);
    });
    const relay = new Relay({
      connection: { host: redisHost },
      prefix,
      namespace,
      inboxMaxLength: 1,
      heartbeatInterval: 60_000,
      backend: () => backend,
    });
    relays.push(relay);
    const received: unknown[] = [];
    try {
      await relay.subscribe('a', message => {
        received.push(message.data);
      });
      await relay.publish('a', 1);
      await vi.waitFor(() => expect(held).toBe(true));
      await relay.publish('a', 2);
      expect(received).toEqual([]);
      await expect(relay.getNodes()).resolves.toMatchObject([{ dropped: 0 }]);
      await relay.publish('a', 3);
      await expect(relay.getNodes()).resolves.toMatchObject([{ dropped: 1 }]);
      release();
      await vi.waitFor(() => expect(received).toEqual([1, 3]));
      await expect(relay.getNodes()).resolves.toMatchObject([{ dropped: 1 }]);
    } finally {
      release();
    }
  });

  it('keeps a fetched batch when the heartbeat before its dispatch fails', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    const backend = await newBackend();
    let fetched = false;
    let failed = false;
    const readInbox = backend.readInbox.bind(backend);
    vi.spyOn(backend, 'readInbox').mockImplementation(async (...args) => {
      const batch = await readInbox(...args);
      fetched ||= batch.entries.length > 0;
      return batch;
    });
    const heartbeat = backend.heartbeat.bind(backend);
    vi.spyOn(backend, 'heartbeat').mockImplementation(async (...args) => {
      if (fetched && !failed) {
        failed = true;
        // Overflows the inbox while the fetched entry is not dispatched yet.
        await backend.publish('a', '2', publishOptions);
        throw new Error('heartbeat failed');
      }
      return heartbeat(...args);
    });
    const relay = new Relay({
      connection: { host: redisHost },
      prefix,
      namespace,
      inboxMaxLength: 1,
      heartbeatInterval: 60_000,
      backend: () => backend,
    });
    relays.push(relay);
    const errors: Error[] = [];
    relay.on('error', err => errors.push(err));
    const received: unknown[] = [];
    await relay.subscribe('a', message => {
      received.push(message.data);
    });
    await relay.publish('a', 1);
    await vi.waitFor(() => expect(received).toEqual([1, 2]), {
      timeout: 5_000,
    });
    expect(errors.map(err => err.message)).toEqual(['heartbeat failed']);
    await expect(relay.getNodes()).resolves.toMatchObject([{ dropped: 0 }]);
  });

  it('does not deliver entries trimmed between a blocking wakeup and the atomic fetch', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    const backend = await newBackend();
    await backend.registerNode('n1', 30_000, {}, 1);
    await backend.subscribe('n1', 'e1', 'a');
    const connection = await (backend as any).getBlockingConnection();
    const client = await connection.client;
    let wakeupStarted!: () => void;
    const waiting = new Promise<void>(resolve => {
      wakeupStarted = resolve;
    });
    vi.spyOn(client, 'xread').mockImplementation(async () => {
      wakeupStarted();
      const result = await IORedis.prototype.xread.call(
        client,
        'BLOCK',
        5_000,
        'COUNT',
        1,
        'STREAMS',
        `${base()}:n1:inbox`,
        '0-0',
      );
      await backend.publish('a', '2', publishOptions);
      return result;
    });
    const reading = backend.readInbox('n1', '0-0', {
      blockMs: 5_000,
      count: 10,
    });
    await waiting;
    await backend.publish('a', '1', publishOptions);
    const batch = await reading;
    expect(batch.entries.map(entry => entry.data)).toEqual(['2']);
    expect((await backend.getNodes(0, -1))[0].dropped).toBe(1);
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
    const inboxKey = `${base()}:${subscriber.nodeId}:inbox`;
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
        `:${subscriber.nodeId}:inbox`,
        ':layout',
        ':mid',
        `:${publisher.nodeId}:node`,
        `:${subscriber.nodeId}:node`,
        ':nodes',
        ':a.b:ret',
        ':retained',
        ':started',
        ':subs',
      ].sort(),
    );
    for (const key of [...keys, `${prefix}::relay:namespaces`]) {
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

  it('closes while the inbox connection is still initializing', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    let socket: Socket | undefined;
    // Accept the connection without answering Redis's startup commands.
    const server = createServer(accepted => {
      socket = accepted;
      socket.resume();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    let inboxClient: IORedis | undefined;
    const duplicate = vi.spyOn(admin, 'duplicate').mockImplementation(opts => {
      inboxClient = new IORedis({
        ...opts,
        host: '127.0.0.1',
        port,
      });
      return inboxClient;
    });
    const relay = new Relay({ connection: admin, prefix, namespace });
    relays.push(relay);
    relay.on('error', () => undefined);
    try {
      await relay.waitUntilReady();
      const backend = (relay as any).backend as RedisRelayBackend;
      await waitFor(() => !!socket && !!(backend as any).blockingConnection);
      expect((backend as any).blockingConnection.status).toBe('initializing');
      const closed = vi.fn();
      const closing = relay.close().then(closed);
      await waitFor(() => closed.mock.calls.length === 1, 1_000);
      await closing;
      expect(inboxClient!.status).toBe('end');
      expect(await admin.ping()).toBe('PONG');
    } finally {
      duplicate.mockRestore();
      inboxClient?.disconnect();
      socket?.destroy();
      await relay.close();
      await new Promise<void>((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve())),
      );
    }
  });

  it('retries its inbox connection after it fails to initialize', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    const backend = await newBackend();
    await backend.registerNode('n1', 30_000);
    await backend.subscribe('n1', 'e1', 'a');
    await backend.publish('a', '1', publishOptions);
    const init = vi
      .spyOn(RedisConnection.prototype as any, 'getRedisVersionAndType')
      .mockRejectedValueOnce(new Error('INFO failed'));
    try {
      await expect(
        backend.readInbox('n1', '0-0', { blockMs: 0, count: 10 }),
      ).rejects.toThrow('INFO failed');
      expect((backend as any).blockingConnection).toBeUndefined();

      const { entries } = await backend.readInbox('n1', '0-0', {
        blockMs: 0,
        count: 10,
      });
      expect(entries.map(entry => entry.data)).toEqual(['1']);
      expect(init).toHaveBeenCalledTimes(2);
    } finally {
      init.mockRestore();
    }
  });

  it('recovers an ioredis Cluster inbox connection left with an empty node pool', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    const mockCluster = (overrides: Record<string, any> = {}) => ({
      // Already-augmented client: RedisConnection uses it as is.
      __bullmq_iredis: true,
      isCluster: true,
      status: 'ready',
      options: { redisOptions: {} },
      on: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
      removeListener: vi.fn(),
      getMaxListeners: vi.fn().mockReturnValue(10),
      setMaxListeners: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      duplicate: vi.fn(),
      quit: vi.fn().mockResolvedValue('OK'),
      defineCommand: vi.fn(),
      nodes: vi.fn().mockReturnValue([{}]),
      bzpopmin: vi.fn().mockResolvedValue(null),
      ...overrides,
    });
    // After an outage, the inbox client is left without nodes until
    // reconnected: every command fails meanwhile.
    let hasNodes = false;
    const runCommand = vi.fn(async () => {
      if (!hasNodes) {
        throw new Error('None of startup nodes is available');
      }
      return null;
    });
    const xread = vi.fn(async () => {
      if (!hasNodes) {
        throw new Error('None of startup nodes is available');
      }
      hasNodes = false;
      throw new Error('Command timed out');
    });
    const inbox = mockCluster({
      connect: vi.fn(async () => {
        hasNodes = true;
      }),
      nodes: vi.fn(() => (hasNodes ? [{}] : [])),
      runCommand,
      xread,
    });
    const cluster = mockCluster({ duplicate: vi.fn().mockReturnValue(inbox) });
    const backend = new RedisRelayBackend({
      connection: cluster as any,
      prefix,
      namespace,
      skipVersionCheck: true,
    });
    backends.push(backend);

    // Reconnected before the read.
    expect(
      await backend.readInbox('n1', '0-0', { blockMs: 0, count: 10 }),
    ).toEqual({ entries: [], cursor: '0-0' });
    expect(inbox.disconnect).toHaveBeenCalledWith(false);
    expect(inbox.connect).toHaveBeenCalledTimes(1);

    // Reconnected after a blocking wakeup that failed with the cluster.
    await expect(
      backend.readInbox('n1', '0-0', { blockMs: 1_000, count: 10 }),
    ).rejects.toThrow('Command timed out');
    expect(inbox.connect).toHaveBeenCalledTimes(2);
    expect(hasNodes).toBe(true);

    // The same connection reads again.
    expect(
      await backend.readInbox('n1', '0-0', { blockMs: 0, count: 10 }),
    ).toEqual({ entries: [], cursor: '0-0' });
    expect(cluster.duplicate).toHaveBeenCalledTimes(1);
  });

  it('expires the retained index with the remaining retained messages after a deletion', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    const backend = await newBackend();
    await backend.publish('a', 'long', {
      ...publishOptions,
      retainMs: 3_600_000,
    });
    await backend.publish('b', 'short', { ...publishOptions, retainMs: 1_000 });
    expect(await admin.pttl(`${base()}:retained`)).toBeGreaterThan(1_000);
    expect(await admin.pttl(`${base()}:mid`)).toBeGreaterThan(1_000);

    expect(await backend.deleteRetained('a')).toBe(true);

    for (const key of [':retained', ':mid']) {
      const ttl = await admin.pttl(`${base()}${key}`);
      expect(ttl, key).toBeGreaterThan(0);
      expect(ttl, key).toBeLessThanOrEqual(1_000);
    }

    expect(await backend.deleteRetained('b')).toBe(true);
    expect(await admin.keys(`${base()}:*`)).toEqual([]);
  });

  it('never shares keys with queues nor looks like one, whatever the names', async () => {
    const isolated = `relay-names-${randomUUID().slice(0, 8)}`;
    namespace = `t-${randomUUID().slice(0, 13)}`;
    // A queue named "relay", with job ids shaped like relay keys.
    const queue = new Queue('relay', {
      connection: { host: redisHost },
      prefix: isolated,
    });
    const relayBackends: RedisRelayBackend[] = [];
    // Everything runs inside try, so a failure never leaves the queue behind.
    try {
      for (const jobId of ['namespaces', '{id}', 'layout']) {
        await queue.add('job', { jobId }, { jobId });
      }
      const queueKeys = new Set(await admin.keys(`${isolated}:*`));

      for (const ns of ['id', 'meta', 'relay']) {
        const backend = new RedisRelayBackend({
          connection: { host: redisHost },
          prefix: isolated,
          namespace: ns,
        });
        relayBackends.push(backend);
        await backend.waitUntilReady();
        for (const node of ['id', 'meta']) {
          await backend.registerNode(node, 30_000);
          for (const topic of ['id', 'x:id', 'meta', 'jobs.*']) {
            await backend.subscribe(node, 'e1', topic);
          }
        }
        for (const topic of ['id', 'x:id', 'meta', 'jobs.id']) {
          await backend.publish(topic, '1', {
            ...publishOptions,
            retainMs: 60_000,
          });
        }
      }

      const relayKeys = (await admin.keys(`${isolated}:*`)).filter(
        key => !queueKeys.has(key),
      );
      expect(relayKeys.length).toBeGreaterThan(30);
      for (const key of relayKeys) {
        expect(key.startsWith(`${isolated}::relay:`), key).toBe(true);
      }

      // Both ways dashboards discover queues: Taskforce.sh's "*:*:id" scan and
      // the connector's "id"/"meta" key suffixes.
      const discovered = new Set<string>();
      for (const key of await admin.keys(`${isolated}:*`)) {
        const suffix = key.slice(key.lastIndexOf(':') + 1);
        if (suffix === 'id' || suffix === 'meta') {
          const rest = key.slice(0, key.lastIndexOf(':'));
          discovered.add(
            `${rest.slice(0, rest.lastIndexOf(':'))} / ${rest.slice(rest.lastIndexOf(':') + 1)}`,
          );
        }
      }
      expect([...discovered]).toEqual([`${isolated} / relay`]);

      expect(await queue.getJobCounts('waiting')).toEqual({ waiting: 3 });
      expect((await queue.getJob('namespaces'))!.data).toEqual({
        jobId: 'namespaces',
      });
      expect(await relayBackends[0].getNamespaces()).toEqual([
        'id',
        'meta',
        'relay',
      ]);
      expect(await relayBackends[0].getCounts()).toEqual({
        nodes: 2,
        subscriptions: 8,
        patterns: 4,
        retained: 4,
      });
    } finally {
      await Promise.all(relayBackends.map(backend => backend.close()));
      await queue.close();
      const keys = await admin.keys(`${isolated}:*`);
      if (keys.length > 0) {
        await admin.del(...keys);
      }
    }
  });

  it('refuses to share a namespace with nodes of another layout version', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    const backend = await newBackend();
    await backend.registerNode('n1', 30_000);
    expect(await admin.hget(`${base()}:layout`, 'layout')).toBe('1');
    await admin.hset(`${base()}:layout`, 'layout', '2');
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
    await admin.del(`${base()}:${node}:node`);
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
      expect(await admin.exists(`${base()}:dead:inbox`)).toBe(1);
      await kill('dead');

      expect(await backend.sweep(1)).toEqual(['dead']);
      expect(await admin.zscore(`${base()}:nodes`, 'dead')).toBeNull();
      expect(await admin.exists(`${base()}:dead:inbox`)).toBe(0);
      expect(await backend.heartbeat('dead', 30_000)).toBe(false);
      expect(await subscriptionsOf('dead')).toBe(250);
      expect(await admin.zrange(`${base()}:cleanup`, 0, -1)).toEqual(['dead']);
      expect(
        await backend.publish('jobs.p0.done', 'after', publishOptions),
      ).toMatchObject({ nodes: 1, endpoints: 1 });
      expect(await admin.exists(`${base()}:dead:inbox`)).toBe(0);

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
          await admin.exists(`${base()}:reuse:node`, `${base()}:reuse:inbox`),
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
      expect(await admin.exists(`${base()}:reuse:inbox`)).toBe(0);
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
