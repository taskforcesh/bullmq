import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { Pool, PoolClient } from 'pg';
import { createPostgresRelayBackend, Relay } from '../../src';
import { getPostgresUrl } from './utils/postgres-url';

// PostgreSQL-specific relay tests (transaction-level races). The
// backend-agnostic relay tests are tests/relay*.test.ts.
const schema = 'bullmq_relay_pg_test';
const otherSchema = `${schema}_other`;
const connection = (targetSchema = schema) => ({
  connectionString: getPostgresUrl(),
  schema: targetSchema,
  migrate: true,
});

let pool: Pool;

beforeAll(async () => {
  pool = new Pool({ connectionString: getPostgresUrl() });
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await pool.query(`DROP SCHEMA IF EXISTS "${otherSchema}" CASCADE`);
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await pool.query(`DROP SCHEMA IF EXISTS "${otherSchema}" CASCADE`);
  await pool.end();
});

describe('Relay (postgres) concurrency', () => {
  it('rejects a supplied pool with max below 2 before using it', async () => {
    const supplied = new Pool({
      connectionString: getPostgresUrl(),
      max: 1,
    });
    const connect = vi.spyOn(supplied, 'connect');
    try {
      expect(
        () =>
          new Relay({
            connection: supplied,
            backend: createPostgresRelayBackend,
          }),
      ).toThrow('Relay requires a supplied PostgreSQL pool with max >= 2');
      expect(connect).not.toHaveBeenCalled();
    } finally {
      await supplied.end();
    }
  });

  it('reads and publishes with a minimally sized owned pool', async () => {
    const namespace = `t-${randomUUID().slice(0, 13)}`;
    const relay = new Relay({
      connection: { ...connection(), max: 1 },
      backend: createPostgresRelayBackend,
      namespace,
    });
    try {
      await relay.waitUntilReady();
      const messages: unknown[] = [];
      await relay.subscribe('a', message => {
        messages.push(message.data);
      });
      await relay.publish('a', 1);
      await vi.waitFor(() => expect(messages).toEqual([1]));
    } finally {
      await relay.close();
    }
  });

  it('returns at once from an inbox read whose listener fails while reading', async () => {
    const backend = createPostgresRelayBackend({
      connection: connection(),
      namespace: `t-${randomUUID().slice(0, 13)}`,
    });
    try {
      await backend.waitUntilReady();
      await backend.registerNode('n1', 30_000);
      const postgresConnection = (backend as any).connection;
      const readRows = (backend as any).readRows.bind(backend);
      vi.spyOn(backend as any, 'readRows').mockImplementationOnce(
        async (...args: unknown[]) => {
          const rows = await readRows(...args);
          postgresConnection.emit('listenerinvalidated');
          return rows;
        },
      );
      const start = Date.now();
      await expect(
        backend.readInbox('n1', backend.initialInboxCursor, {
          blockMs: 10_000,
          count: 10,
        }),
      ).resolves.toMatchObject({ entries: [] });
      expect(Date.now() - start).toBeLessThan(2_000);
    } finally {
      await backend.close();
    }
  });

  it('forwards connection errors only when an error listener is attached', async () => {
    const backend = createPostgresRelayBackend({
      connection: connection(),
      namespace: `t-${randomUUID().slice(0, 13)}`,
    });
    try {
      await backend.waitUntilReady();
      const postgresConnection = (backend as any).connection;
      expect(() =>
        postgresConnection.emit('error', new Error('unobserved')),
      ).not.toThrow();

      const error = new Error('connection failed');
      const errors: Error[] = [];
      backend.on('error', err => errors.push(err));
      postgresConnection.emit('error', error);
      expect(errors).toEqual([error]);
    } finally {
      await backend.close();
    }
  });

  it('uses distinct connection names for long namespace and node IDs', async () => {
    const prefix = `${randomUUID().replace(/-/g, '')}${'x'.repeat(31)}`;
    const nodePrefix = 'n'.repeat(63);
    const nodeIds = [`${nodePrefix}a`, `${nodePrefix}b`];
    const backends = [
      createPostgresRelayBackend({
        connection: connection(),
        namespace: `${prefix}a`,
        nodeId: nodeIds[0],
      }),
      createPostgresRelayBackend({
        connection: connection(),
        namespace: `${prefix}b`,
        nodeId: nodeIds[1],
      }),
    ];
    try {
      await Promise.all(backends.map(backend => backend.waitUntilReady()));
      await Promise.all(
        backends.map((backend, index) =>
          backend.registerNode(nodeIds[index], 30_000),
        ),
      );
      await Promise.all(
        backends.map((backend, index) =>
          backend.readInbox(nodeIds[index], '', { blockMs: 0, count: 1 }),
        ),
      );

      const connections = await Promise.all(
        backends.map((backend, index) =>
          backend.getNodeConnections(nodeIds[index]),
        ),
      );
      expect(
        connections.map(nodeConnections => nodeConnections.length),
      ).toEqual([1, 1]);
    } finally {
      await Promise.all(backends.map(backend => backend.close()));
    }
  });

  it('isolates inbox connection discovery across schemas', async () => {
    const namespace = `t-${randomUUID().slice(0, 13)}`;
    const nodeId = 'same-node';
    const backends = [
      createPostgresRelayBackend({
        connection: connection(),
        namespace,
        nodeId,
      }),
      createPostgresRelayBackend({
        connection: connection(otherSchema),
        namespace,
        nodeId,
      }),
    ];
    try {
      await Promise.all(backends.map(backend => backend.waitUntilReady()));
      await Promise.all(
        backends.map(backend => backend.registerNode(nodeId, 30_000)),
      );
      await Promise.all(
        backends.map(backend =>
          backend.readInbox(nodeId, '', { blockMs: 0, count: 1 }),
        ),
      );

      const connections = await Promise.all(
        backends.map(backend => backend.getNodeConnections(nodeId)),
      );
      expect(
        connections.map(nodeConnections => nodeConnections.length),
      ).toEqual([1, 1]);

      await backends[1].close();
      await expect(
        backends[0].getNodeConnections(nodeId),
      ).resolves.toHaveLength(1);
    } finally {
      await Promise.all(backends.map(backend => backend.close()));
      await pool.query(`DELETE FROM "${schema}".relay_node WHERE ns = $1`, [
        namespace,
      ]);
      await pool.query(
        `DELETE FROM "${otherSchema}".relay_node WHERE ns = $1`,
        [namespace],
      );
    }
  });

  it('does not count inbox batch entries as dropped while dispatching', async () => {
    const namespace = `t-${randomUUID().slice(0, 13)}`;
    const backend = createPostgresRelayBackend({
      connection: connection(),
      namespace,
    });
    const signal = () => {
      let resolve!: () => void;
      const promise = new Promise<void>(r => {
        resolve = r;
      });
      return { promise, resolve };
    };
    // The first read waits until every message is published, so they are
    // fetched as one batch; the heartbeat that readLoop() awaits after
    // marking that batch in flight is then held while trimming is attempted.
    const firstRead = signal();
    const releaseRead = signal();
    const batchHeartbeat = signal();
    const releaseHeartbeat = signal();
    let batchFetched = false;
    let heartbeatHeld = false;
    const readInbox = backend.readInbox.bind(backend);
    vi.spyOn(backend, 'readInbox').mockImplementation(async (...args) => {
      firstRead.resolve();
      await releaseRead.promise;
      const batch = await readInbox(...args);
      batchFetched ||= batch.entries.length > 0;
      return batch;
    });
    const heartbeat = backend.heartbeat.bind(backend);
    vi.spyOn(backend, 'heartbeat').mockImplementation(async (...args) => {
      if (batchFetched && !heartbeatHeld) {
        heartbeatHeld = true;
        batchHeartbeat.resolve();
        await releaseHeartbeat.promise;
      }
      return heartbeat(...args);
    });
    const trimInbox = vi.spyOn(backend, 'trimInbox');
    const relay = new Relay({
      connection: connection(),
      namespace,
      inboxMaxLength: 1,
      backend: () => backend,
    });
    const messages: unknown[] = [];
    try {
      await relay.waitUntilReady();
      await firstRead.promise;
      await relay.subscribe('a', message => {
        messages.push(message.data);
      });
      for (const value of [1, 2, 3]) {
        await relay.publish('a', value);
      }
      releaseRead.resolve();

      await batchHeartbeat.promise;
      expect((relay as any).batchInFlight).toBe(true);
      await (relay as any).checkBacklog();
      expect(trimInbox).not.toHaveBeenCalled();
      expect(messages).toEqual([]);
      releaseHeartbeat.resolve();

      await vi.waitFor(() => expect(messages).toEqual([1, 2, 3]));
      await expect(relay.getNodes()).resolves.toMatchObject([{ dropped: 0 }]);
    } finally {
      releaseRead.resolve();
      releaseHeartbeat.resolve();
      await relay.close();
    }
  });

  it('does not count a fetched batch as dropped when trimming before readLoop gets it', async () => {
    const namespace = `t-${randomUUID().slice(0, 13)}`;
    const backend = createPostgresRelayBackend({
      connection: connection(),
      namespace,
    });
    const signal = () => {
      let resolve!: () => void;
      const promise = new Promise<void>(r => {
        resolve = r;
      });
      return { promise, resolve };
    };
    // The first read waits until every message is published, so they are
    // fetched as one batch; its response is then held before readLoop() gets
    // it (and marks it in flight) while the inbox is trimmed.
    const firstRead = signal();
    const releaseRead = signal();
    const batchFetched = signal();
    const releaseBatch = signal();
    let held = false;
    const readInbox = backend.readInbox.bind(backend);
    vi.spyOn(backend, 'readInbox').mockImplementation(async (...args) => {
      firstRead.resolve();
      await releaseRead.promise;
      const batch = await readInbox(...args);
      if (batch.entries.length > 0 && !held) {
        held = true;
        batchFetched.resolve();
        await releaseBatch.promise;
      }
      return batch;
    });
    const trimInbox = vi.spyOn(backend, 'trimInbox');
    const relay = new Relay({
      connection: connection(),
      namespace,
      inboxMaxLength: 1,
      backend: () => backend,
    });
    const messages: unknown[] = [];
    try {
      await relay.waitUntilReady();
      await firstRead.promise;
      await relay.subscribe('a', message => {
        messages.push(message.data);
      });
      for (const value of [1, 2, 3]) {
        await relay.publish('a', value);
      }
      releaseRead.resolve();

      await batchFetched.promise;
      expect((relay as any).batchInFlight).toBe(false);
      await (relay as any).checkBacklog();
      expect(trimInbox).toHaveBeenCalledTimes(1);
      await expect(relay.getNodes()).resolves.toMatchObject([{ dropped: 0 }]);
      releaseBatch.resolve();

      await vi.waitFor(() => expect(messages).toEqual([1, 2, 3]));
      await expect(relay.getNodes()).resolves.toMatchObject([{ dropped: 0 }]);
    } finally {
      releaseRead.resolve();
      releaseBatch.resolve();
      await relay.close();
    }
  });

  it('does not deliver entries left pending by an expired lease after recovering', async () => {
    const namespace = `t-${randomUUID().slice(0, 13)}`;
    const backend = createPostgresRelayBackend({
      connection: connection(),
      namespace,
    });
    let resolveHeld!: () => void;
    const readHeld = new Promise<void>(resolve => {
      resolveHeld = resolve;
    });
    let releaseRead!: () => void;
    const readReleased = new Promise<void>(resolve => {
      releaseRead = resolve;
    });
    // Holds the first read so the message stays pending in the inbox.
    let holdRead = true;
    const readInbox = backend.readInbox.bind(backend);
    vi.spyOn(backend, 'readInbox').mockImplementation(async (...args) => {
      if (holdRead) {
        holdRead = false;
        resolveHeld();
        await readReleased;
      }
      return readInbox(...args);
    });
    const relay = new Relay({
      connection: connection(),
      namespace,
      heartbeatInterval: 60_000,
      backend: () => backend,
    });
    const other = createPostgresRelayBackend({
      connection: connection(),
      namespace,
    });
    const events: unknown[] = [];
    try {
      await relay.waitUntilReady();
      await readHeld;
      relay.on('recovered', () => events.push('recovered'));
      await relay.subscribe('a', message => {
        events.push(message.data);
      });

      // Shortens the lease, then routes a message while it is still valid.
      await other.registerNode(relay.nodeId, 200);
      await other.publish('a', '"stale"', {
        ts: 1,
        retainMs: 0,
        maxSize: 100,
      });
      const inbox = `"${schema}".relay_inbox`;
      const { rows: pending } = await pool.query(
        `SELECT count(*)::int AS n FROM ${inbox} WHERE ns = $1 AND node_id = $2`,
        [namespace, relay.nodeId],
      );
      expect(pending[0].n).toBe(1);
      await new Promise(resolve => setTimeout(resolve, 400));

      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO "${schema}"`);
        const { rows: read } = await client.query(
          `SELECT * FROM relay_read_inbox($1, $2, '{}'::bigint[], 100)`,
          [namespace, relay.nodeId],
        );
        expect(read).toEqual([]);
      } finally {
        await client.query('RESET search_path');
        client.release();
      }

      releaseRead();
      await (relay as any).heartbeat();
      expect(events).toEqual(['recovered']);

      await other.publish('a', '"back"', {
        ts: 2,
        retainMs: 0,
        maxSize: 100,
      });
      await vi.waitFor(() => expect(events).toEqual(['recovered', 'back']));
    } finally {
      releaseRead();
      await relay.close();
      await other.close();
    }
  });

  it('discards an inbox batch fetched before a recovery replaced its registration', async () => {
    const namespace = `t-${randomUUID().slice(0, 13)}`;
    const backend = createPostgresRelayBackend({
      connection: connection(),
      namespace,
    });
    let resolveFetched!: () => void;
    const batchFetched = new Promise<void>(resolve => {
      resolveFetched = resolve;
    });
    let releaseBatch!: () => void;
    const batchReleased = new Promise<void>(resolve => {
      releaseBatch = resolve;
    });
    // Holds the first non-empty batch after it was read, while the lease
    // expires and a heartbeat recovers the node.
    let holdBatch = true;
    const readInbox = backend.readInbox.bind(backend);
    vi.spyOn(backend, 'readInbox').mockImplementation(async (...args) => {
      const batch = await readInbox(...args);
      if (holdBatch && batch.entries.length > 0) {
        holdBatch = false;
        resolveFetched();
        await batchReleased;
      }
      return batch;
    });
    const relay = new Relay({
      connection: connection(),
      namespace,
      heartbeatInterval: 60_000,
      backend: () => backend,
    });
    const other = createPostgresRelayBackend({
      connection: connection(),
      namespace,
    });
    const events: unknown[] = [];
    try {
      await relay.waitUntilReady();
      relay.on('recovered', () => events.push('recovered'));
      await relay.subscribe('a', message => {
        events.push(message.data);
      });

      await other.registerNode(relay.nodeId, 200);
      await other.publish('a', '"stale"', {
        ts: 1,
        retainMs: 0,
        maxSize: 100,
      });
      await batchFetched;
      await new Promise(resolve => setTimeout(resolve, 400));
      await (relay as any).heartbeat();
      expect(events).toEqual(['recovered']);

      releaseBatch();
      await other.publish('a', '"back"', {
        ts: 2,
        retainMs: 0,
        maxSize: 100,
      });
      await vi.waitFor(() => expect(events).toEqual(['recovered', 'back']));
    } finally {
      releaseBatch();
      await relay.close();
      await other.close();
    }
  });

  it.each(['subscribe', 'publish'] as const)(
    'serializes retained delivery when %s commits first',
    async firstOperation => {
      const namespace = `t-${randomUUID().slice(0, 13)}`;
      const backend = createPostgresRelayBackend({
        connection: connection(),
        namespace,
      });
      await backend.waitUntilReady();
      await backend.registerNode('n1', 30_000);
      const first = await pool.connect();
      const second = await pool.connect();
      const run = (client: PoolClient, operation: 'subscribe' | 'publish') =>
        client.query(
          operation === 'subscribe'
            ? `SELECT * FROM relay_subscribe($1, 'n1', 'e1', 'a')`
            : `SELECT * FROM relay_publish($1, 'a', '"retained"', 1, 30000, 100)`,
          [namespace],
        );
      try {
        for (const client of [first, second]) {
          await client.query('BEGIN');
          await client.query(`SET LOCAL search_path TO "${schema}"`);
          await client.query(`SET LOCAL statement_timeout = '5s'`);
        }
        const { rows: pidRows } = await second.query(
          'SELECT pg_backend_pid() AS pid',
        );
        const firstResult = await run(first, firstOperation);
        const overlapping = run(
          second,
          firstOperation === 'subscribe' ? 'publish' : 'subscribe',
        );
        overlapping.catch(() => undefined);

        // Wait for the competing transaction to reach the topic lock rather
        // than relying on a sleep to arrange the race.
        await vi.waitFor(async () => {
          const { rows } = await pool.query(
            `SELECT count(*)::int AS n FROM pg_locks
             WHERE pid = $1 AND locktype = 'advisory' AND NOT granted`,
            [pidRows[0].pid],
          );
          expect(rows[0].n).toBe(1);
        });
        await first.query('COMMIT');
        const secondResult = await overlapping;
        await second.query('COMMIT');

        const subscription =
          firstOperation === 'subscribe' ? firstResult : secondResult;
        const publication =
          firstOperation === 'publish' ? firstResult : secondResult;
        expect(subscription.rows[0].added).toBe(true);
        const { rows: inbox } = await pool.query(
          `SELECT mid, data, endpoints FROM "${schema}".relay_inbox WHERE ns = $1`,
          [namespace],
        );
        if (firstOperation === 'subscribe') {
          expect(subscription.rows[0].retained_mid).toBeNull();
          expect(publication.rows[0].endpoint_count).toBe(1);
          expect(inbox).toEqual([
            {
              mid: publication.rows[0].message_id,
              data: '"retained"',
              endpoints: ['e1'],
            },
          ]);
        } else {
          expect(subscription.rows[0]).toMatchObject({
            retained_mid: publication.rows[0].message_id,
            retained_data: '"retained"',
          });
          expect(publication.rows[0].endpoint_count).toBe(0);
          expect(inbox).toEqual([]);
        }
      } finally {
        await first.query('ROLLBACK');
        await second.query('ROLLBACK');
        first.release();
        second.release();
        await backend.close();
        await pool.query(`DELETE FROM "${schema}".relay_node WHERE ns = $1`, [
          namespace,
        ]);
        await pool.query(
          `DELETE FROM "${schema}".relay_retained WHERE ns = $1`,
          [namespace],
        );
      }
    },
  );

  it('sweeps expired retained messages from an abandoned namespace in bounded batches', async () => {
    const namespace = `t-${randomUUID().slice(0, 13)}`;
    const abandoned = `${namespace}-old`;
    const publisher = createPostgresRelayBackend({
      connection: connection(),
      namespace: abandoned,
    });
    const sweeper = createPostgresRelayBackend({
      connection: connection(),
      namespace,
    });
    try {
      await publisher.waitUntilReady();
      await sweeper.waitUntilReady();
      await publisher.registerNode('n1', 30_000);
      for (const topic of ['expired1', 'expired2', 'live']) {
        await publisher.publish(topic, '1', {
          ts: 1,
          retainMs: 30_000,
          maxSize: 10,
        });
      }
      await publisher.unregisterNode('n1');
      await publisher.close();
      await pool.query(
        `UPDATE "${schema}".relay_retained
         SET expires_at = clock_timestamp() - interval '1 second'
         WHERE ns = $1 AND topic <> 'live'`,
        [abandoned],
      );

      await expect(sweeper.sweep(1)).resolves.toEqual([]);
      const { rows: remaining } = await pool.query(
        `SELECT topic FROM "${schema}".relay_retained WHERE ns = $1`,
        [abandoned],
      );
      expect(remaining).toHaveLength(2);
      expect(remaining).toContainEqual({ topic: 'live' });

      await expect(sweeper.sweep(1)).resolves.toEqual([]);
      const { rows } = await pool.query(
        `SELECT topic FROM "${schema}".relay_retained WHERE ns = $1`,
        [abandoned],
      );
      expect(rows).toEqual([{ topic: 'live' }]);
    } finally {
      await publisher.close();
      await sweeper.close();
      await pool.query(`DELETE FROM "${schema}".relay_node WHERE ns = $1`, [
        abandoned,
      ]);
      await pool.query(`DELETE FROM "${schema}".relay_retained WHERE ns = $1`, [
        abandoned,
      ]);
    }
  });

  it('a publish racing with a sweep of one of its nodes still succeeds', async () => {
    const namespace = `t-${randomUUID().slice(0, 13)}`;
    const backend = createPostgresRelayBackend({
      connection: connection(),
      namespace,
    });
    await backend.waitUntilReady();
    await backend.registerNode('n1', 30_000);
    await backend.registerNode('n2', 30_000);
    await backend.subscribe('n1', 'e1', 'a');
    await backend.subscribe('n2', 'e2', 'a');

    // Another node is sweeping n1: its delete is not committed yet.
    const sweeper = await pool.connect();
    try {
      await sweeper.query('BEGIN');
      await sweeper.query(
        `DELETE FROM "${schema}".relay_node WHERE ns = $1 AND node_id = 'n1'`,
        [namespace],
      );
      const publishing = backend.publish('a', '1', {
        ts: 1,
        retainMs: 0,
        maxSize: 10,
      });
      await new Promise(resolve => setTimeout(resolve, 200));
      await sweeper.query('COMMIT');

      await expect(publishing).resolves.toMatchObject({
        nodes: 1,
        endpoints: 1,
      });
    } finally {
      sweeper.release();
      await backend.close();
      await pool.query(`DELETE FROM "${schema}".relay_node WHERE ns = $1`, [
        namespace,
      ]);
    }
  });
});
