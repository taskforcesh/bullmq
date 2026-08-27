import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { PostgresConnection } from '../src/postgres/postgres-connection';
import { PostgresQueueBackend } from '../src/postgres/postgres-queue-backend';

/**
 * DB-independent unit tests for the dedicated `LISTEN` client recovery path
 * (the latent risk uncovered while delegating `maximumBlockTimeout`).
 *
 * A `LISTEN` subscription lives on one specific connection. If that connection
 * drops silently, the memoized client is dead and every re-`LISTEN` on it is
 * lost — so a worker could stop receiving NOTIFYs until its next poll. With the
 * Postgres `maximumBlockTimeout` now up to an hour, that window is far too long,
 * so a dropped LISTEN client must be detected (keepAlive) and rebuilt.
 *
 * These drive the logic with fakes (no `pg`, no database).
 */

class FakeStandaloneClient extends EventEmitter {
  connect = vi.fn().mockResolvedValue(undefined);
  query = vi.fn().mockResolvedValue({ rows: [] });
  end = vi.fn().mockResolvedValue(undefined);

  constructor(public readonly config: any) {
    super();
  }
}

/**
 * Builds a `PostgresConnection` instance wired to a fake `pg` module so the
 * standalone `LISTEN` client path can be exercised without a real database.
 */
function makeStandaloneConnection(): {
  connection: PostgresConnection;
  createdClients: FakeStandaloneClient[];
} {
  const connection = Object.create(
    PostgresConnection.prototype,
  ) as PostgresConnection;
  EventEmitter.call(connection);

  const createdClients: FakeStandaloneClient[] = [];
  const anyConn = connection as any;
  class ClientCtor extends FakeStandaloneClient {
    constructor(config: any) {
      super(config);
      createdClients.push(this);
    }
  }
  anyConn.pgModule = { Client: ClientCtor };
  anyConn.listenClientConfig = { connectionString: 'postgres://fake/db' };
  anyConn.listenClientPromise = undefined;
  anyConn.listenClient = undefined;
  anyConn.listenClientIsStandalone = false;
  anyConn.closing = undefined;

  return { connection, createdClients };
}

describe('PostgresConnection LISTEN client recovery', () => {
  it('enables TCP keepAlive on the dedicated standalone LISTEN client', async () => {
    const { connection, createdClients } = makeStandaloneConnection();

    await connection.getListenClient();

    expect(createdClients).toHaveLength(1);
    expect(createdClients[0].config).toMatchObject({ keepAlive: true });
  });

  it('invalidates the memoized client and rebuilds it after a fatal error', async () => {
    const { connection, createdClients } = makeStandaloneConnection();

    const first = await connection.getListenClient();
    expect(createdClients).toHaveLength(1);

    // The dedicated connection drops (surfaced as a socket 'error').
    first.emit('error', new Error('connection terminated unexpectedly'));

    // The broken standalone client is torn down...
    expect(
      (first as unknown as FakeStandaloneClient).end,
    ).toHaveBeenCalledTimes(1);

    // ...and the next request establishes a brand new client.
    const second = await connection.getListenClient();
    expect(createdClients).toHaveLength(2);
    expect(second).not.toBe(first);
  });

  it('emits "listenerinvalidated" when the LISTEN client dies', async () => {
    const { connection } = makeStandaloneConnection();
    const onInvalidated = vi.fn();
    connection.on('listenerinvalidated', onInvalidated);

    const client = await connection.getListenClient();
    client.emit('error', new Error('boom'));

    expect(onInvalidated).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale error from an already-replaced client', async () => {
    const { connection, createdClients } = makeStandaloneConnection();

    const first = await connection.getListenClient();
    first.emit('error', new Error('first drop'));
    const second = await connection.getListenClient();
    expect(createdClients).toHaveLength(2);

    const onInvalidated = vi.fn();
    connection.on('listenerinvalidated', onInvalidated);

    // A late error from the already-discarded first client must not touch the
    // current (second) client's memo.
    first.emit('error', new Error('late duplicate drop'));

    expect(onInvalidated).not.toHaveBeenCalled();
    const third = await connection.getListenClient();
    expect(third).toBe(second);
    expect(createdClients).toHaveLength(2);
  });

  it('does not invalidate while the connection is closing', async () => {
    const { connection, createdClients } = makeStandaloneConnection();

    const client = await connection.getListenClient();
    (connection as any).closing = Promise.resolve();

    const onInvalidated = vi.fn();
    connection.on('listenerinvalidated', onInvalidated);

    client.emit('error', new Error('drop during close'));

    expect(onInvalidated).not.toHaveBeenCalled();
    // The in-flight close() owns teardown, so the error handler must not end it.
    expect(
      (client as unknown as FakeStandaloneClient).end,
    ).not.toHaveBeenCalled();
  });
});

describe('PostgresQueueBackend LISTEN client recovery', () => {
  it('re-subscribes and wakes the blocking wait when the LISTEN client is invalidated', () => {
    const connection = new EventEmitter() as unknown as PostgresConnection;
    (connection as any).schema = 'bullmq';

    const backend = new PostgresQueueBackend(
      connection,
      'test-queue',
      {} as any,
      true,
    );

    const anyBackend = backend as any;
    anyBackend.listening = true;
    anyBackend.listeningEvents = true;
    const cancelWait = vi.fn();
    const cancelEventWait = vi.fn();
    anyBackend.cancelWait = cancelWait;
    anyBackend.cancelEventWait = cancelEventWait;

    connection.emit('listenerinvalidated');

    // Flags reset so the next ensureListening/ensureListeningEvents re-issues
    // LISTEN on the freshly rebuilt client...
    expect(anyBackend.listening).toBe(false);
    expect(anyBackend.listeningEvents).toBe(false);
    // ...and any in-flight wait (parked on the dead client) is woken so the
    // worker loop re-enters waitForJob/readEvents.
    expect(cancelWait).toHaveBeenCalledTimes(1);
    expect(cancelEventWait).toHaveBeenCalledTimes(1);
  });
});
