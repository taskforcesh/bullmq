import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import {
  IRelayBackend,
  RelayBackendOptions,
  RelayCounts,
  RelayInboxBatch,
  RelayNodeConnection,
  RelayNodeInfo,
  RelayNodeState,
  RelayPatternState,
  RelayPublishOptions,
  RelayPublishResult,
  RelayRetainedState,
  RelaySubscribeResult,
  RelaySubscriptionFilter,
  RelaySubscriptionState,
} from '../interfaces';
import { RelayError } from '../classes/relay-errors';
import {
  isPgPool,
  PgListenClient,
  PgNotification,
  PgQueryResult,
} from './pg-types';
import {
  PostgresConnection,
  PostgresConnectionOptions,
} from './postgres-connection';
import { loadCommandSql } from './sql-loader';

const RELAY_CHANNEL = 'bullmq_relay';
/** PostgreSQL truncates `application_name` to 63 bytes. */
const MAX_APPLICATION_NAME = 63;
const APPLICATION_NAME_PREFIX = 'bullmq:relay:';

/**
 * PostgreSQL implementation of {@link IRelayBackend}. Every operation is one of
 * the `relay_*` SQL functions (migration `0004_relay`); this class only passes
 * arguments and decodes rows.
 *
 * Rows have no expiry in PostgreSQL: sweeps remove expired nodes (with their
 * subscriptions and inboxes) and retained messages of every namespace, so a
 * namespace whose nodes all vanished is cleaned by any node using the same
 * schema.
 *
 * Each node's inbox is a table, read after a `NOTIFY` on the `bullmq_relay`
 * channel (or after the wait times out, so a missed notification only delays
 * delivery). Entries are acknowledged by id, which never skips a row whose
 * transaction committed late.
 */
export class PostgresRelayBackend
  extends EventEmitter
  implements IRelayBackend
{
  readonly namespace: string;
  readonly initialInboxCursor = '';

  private readonly connection: PostgresConnection;
  private readonly nodeId?: string;
  private connectionIdentity?: Promise<{
    database: string;
    schema: string;
  }>;
  private listening = false;
  private cancelWait?: () => void;
  /** Set by interruptInbox: reads stop waiting from then on. */
  private interrupted = false;
  private closing?: Promise<void>;

  constructor(opts: RelayBackendOptions<PostgresConnectionOptions>) {
    super();
    if (isPgPool(opts.connection)) {
      const max = (opts.connection as { options?: { max?: number } }).options
        ?.max;
      if (max !== undefined && max < 2) {
        throw new Error(
          'Relay requires a supplied PostgreSQL pool with max >= 2',
        );
      }
    }
    this.namespace = opts.namespace;
    this.nodeId = opts.nodeId;
    this.connection = new PostgresConnection(opts.connection);
    this.connection.on('listenerinvalidated', () => {
      this.listening = false;
      this.cancelWait?.();
    });
    this.connection.on('error', err => {
      if (this.listenerCount('error') > 0) {
        this.emit('error', err);
      }
    });
  }

  waitUntilReady(): Promise<void> {
    return this.connection.waitUntilReady();
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.interruptInbox();
      this.closing = this.connection.close();
    }
    return this.closing;
  }

  async registerNode(
    nodeId: string,
    leaseMs: number,
    info: RelayNodeInfo = {},
    _inboxMaxLength?: number,
  ): Promise<void> {
    await this.run('relay_register_node', [
      this.namespace,
      nodeId,
      leaseMs,
      JSON.stringify(info),
    ]);
  }

  async heartbeat(nodeId: string, leaseMs: number): Promise<boolean> {
    const { rows } = await this.run('relay_heartbeat', [
      this.namespace,
      nodeId,
      leaseMs,
    ]);
    return rows[0].alive;
  }

  async unregisterNode(nodeId: string): Promise<boolean> {
    const { rows } = await this.run('relay_unregister_node', [
      this.namespace,
      nodeId,
    ]);
    return rows[0].removed;
  }

  async sweep(limit: number): Promise<string[]> {
    const { rows } = await this.run('relay_sweep', [this.namespace, limit]);
    return rows.map(row => row.node_id);
  }

  async subscribe(
    nodeId: string,
    endpointId: string,
    pattern: string,
  ): Promise<RelaySubscribeResult> {
    const { rows } = await this.run(
      'relay_subscribe',
      [this.namespace, nodeId, endpointId, pattern],
      pattern,
    );
    const row = rows[0];
    return {
      added: row.added,
      retained:
        row.retained_mid !== null
          ? {
              mid: String(row.retained_mid),
              ts: Number(row.retained_ts),
              data: row.retained_data,
            }
          : undefined,
    };
  }

  async removeEndpoint(nodeId: string, endpointId: string): Promise<number> {
    const { rows } = await this.run('relay_remove_endpoint', [
      this.namespace,
      nodeId,
      endpointId,
    ]);
    return Number(rows[0].removed);
  }

  async publish(
    topic: string,
    data: string,
    opts: RelayPublishOptions,
  ): Promise<RelayPublishResult> {
    const { rows } = await this.run(
      'relay_publish',
      [this.namespace, topic, data, opts.ts, opts.retainMs, opts.maxSize],
      topic,
    );
    const row = rows[0];
    return {
      mid: String(row.message_id),
      nodes: row.node_count,
      endpoints: row.endpoint_count,
    };
  }

  async deleteRetained(topic: string): Promise<boolean> {
    const { rows } = await this.run(
      'relay_delete_retained',
      [this.namespace, topic],
      topic,
    );
    return rows[0].deleted;
  }

  async readInbox(
    nodeId: string,
    cursor: string,
    opts: { blockMs: number; count: number },
  ): Promise<RelayInboxBatch> {
    const payload = `${this.namespace}:${nodeId}`;
    const client = await this.ensureListening();
    let notified = false;
    let wake: (() => void) | undefined;
    const onNotify = (msg: PgNotification) => {
      if (msg.channel === RELAY_CHANNEL && msg.payload === payload) {
        notified = true;
        wake?.();
      }
    };
    // Registered before reading, so a notification for a row committed right
    // after the read is not missed.
    client.on('notification', onNotify);
    try {
      const ack = cursor ? cursor.split(',') : [];
      let rows = await this.readRows(nodeId, ack, opts.count);
      // A listener invalidated while reading would never wake the wait: return
      // so the next read listens again on a new connection.
      if (
        rows.length === 0 &&
        !notified &&
        opts.blockMs > 0 &&
        !this.interrupted &&
        this.listening
      ) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(done, opts.blockMs);
          function done() {
            clearTimeout(timer);
            resolve();
          }
          wake = done;
          this.cancelWait = done;
        });
        this.cancelWait = undefined;
        if (!this.interrupted) {
          rows = await this.readRows(nodeId, [], opts.count);
        }
      }
      return {
        entries: rows.map(row => ({
          kind: row.kind,
          topic: row.topic,
          mid: String(row.mid),
          ts: Number(row.ts),
          data: row.data,
          endpoints: row.endpoints,
        })),
        cursor: rows.map(row => row.id).join(','),
      };
    } finally {
      client.removeListener('notification', onNotify);
    }
  }

  async trimInbox(
    nodeId: string,
    cursor: string,
    maxLength: number,
  ): Promise<number> {
    const { rows } = await this.run('relay_trim_inbox', [
      this.namespace,
      nodeId,
      cursor ? cursor.split(',') : [],
      maxLength,
    ]);
    return rows[0].backlog;
  }

  async getCounts(): Promise<RelayCounts> {
    const { rows } = await this.run('relay_get_counts', [this.namespace]);
    return rows[0];
  }

  async getNodes(start: number, end: number): Promise<RelayNodeState[]> {
    const { rows } = await this.run('relay_get_nodes', [
      this.namespace,
      start,
      end,
    ]);
    return rows.map(row => ({
      id: row.node_id,
      info: row.info ?? {},
      registeredAt: Number(row.registered_at),
      leaseUntil: Number(row.lease_until),
      lastHeartbeat:
        row.last_heartbeat === null ? undefined : Number(row.last_heartbeat),
      backlog: row.backlog,
      dropped: Number(row.dropped),
      subscriptions: row.subscriptions,
    }));
  }

  async getSubscriptions(
    filter: RelaySubscriptionFilter | undefined,
    start: number,
    end: number,
  ): Promise<RelaySubscriptionState[]> {
    const { rows } = await this.run('relay_get_subscriptions', [
      this.namespace,
      filter && 'nodeId' in filter ? filter.nodeId : null,
      filter && 'pattern' in filter ? filter.pattern : null,
      start,
      end,
    ]);
    return rows.map(row => ({
      nodeId: row.node_id,
      endpointId: row.endpoint_id,
      pattern: row.pattern,
    }));
  }

  async getPatterns(start: number, end: number): Promise<RelayPatternState[]> {
    const { rows } = await this.run('relay_get_patterns', [
      this.namespace,
      start,
      end,
    ]);
    return rows;
  }

  async getRetained(start: number, end: number): Promise<RelayRetainedState[]> {
    const { rows } = await this.run('relay_get_retained', [
      this.namespace,
      start,
      end,
    ]);
    return rows.map(row => ({
      topic: row.topic,
      expiresAt: Number(row.expires_at),
      mid: String(row.mid),
      ts: Number(row.ts),
      data: row.data,
    }));
  }

  async getNamespaces(): Promise<string[]> {
    const { rows } = await this.run('relay_get_namespaces', []);
    return rows.map(row => row.ns);
  }

  async getNodeConnections(nodeId: string): Promise<RelayNodeConnection[]> {
    await this.connection.waitUntilReady();
    const { database, schema } = await this.getConnectionIdentity();
    const { rows } = await this.run('relay_get_node_connections', [
      this.inboxConnectionName(nodeId, database, schema),
      database,
    ]);
    return rows.map(row => ({
      address: row.address,
      age: Number(row.age),
      idle: Number(row.idle),
    }));
  }

  /**
   * Makes a blocked readInbox return, and later reads return without
   * waiting: an interrupt that lands while a read is still querying (before
   * it starts waiting) must not be lost.
   */
  interruptInbox(): void {
    this.interrupted = true;
    this.cancelWait?.();
  }

  /** `application_name` of a node's inbox connection. */
  private inboxConnectionName(
    nodeId: string,
    database: string,
    schema: string,
  ) {
    const digest = createHash('sha256')
      .update(JSON.stringify([database, schema, this.namespace, nodeId]))
      .digest('hex');
    return `${APPLICATION_NAME_PREFIX}${digest.slice(
      0,
      MAX_APPLICATION_NAME - APPLICATION_NAME_PREFIX.length,
    )}`;
  }

  private getConnectionIdentity(): Promise<{
    database: string;
    schema: string;
  }> {
    if (!this.connectionIdentity) {
      let identity: Promise<{ database: string; schema: string }>;
      identity = this.connection.pool
        .query<{ database: string; schema: string }>(
          'SELECT current_database() AS database, current_schema() AS schema',
        )
        .then(({ rows }) => rows[0])
        .catch(err => {
          if (this.connectionIdentity === identity) {
            this.connectionIdentity = undefined;
          }
          throw err;
        });
      this.connectionIdentity = identity;
    }
    return this.connectionIdentity;
  }

  private async readRows(nodeId: string, ack: string[], count: number) {
    const { rows } = await this.run('relay_read_inbox', [
      this.namespace,
      nodeId,
      ack,
      count,
    ]);
    return rows;
  }

  private async ensureListening(): Promise<PgListenClient> {
    await this.connection.waitUntilReady();
    const client = await this.connection.getListenClient();
    if (!this.listening) {
      if (this.nodeId) {
        const { database, schema } = await this.getConnectionIdentity();
        // Named after the node (re-applied if the connection is rebuilt) so
        // getNodeConnections can find it.
        await this.connection.setListenClientName(
          this.inboxConnectionName(this.nodeId, database, schema),
        );
      }
      await client.query(loadCommandSql('listen_relay'));
      this.listening = true;
    }
    return client;
  }

  private async run(
    command: string,
    params: unknown[],
    detail?: string,
  ): Promise<PgQueryResult<any>> {
    await this.connection.waitUntilReady();
    try {
      return await this.connection.pool.query(loadCommandSql(command), params);
    } catch (err) {
      if ((err as { code?: string }).code === 'BM001') {
        throw new RelayError(
          Number((err as { detail?: string }).detail),
          detail,
        );
      }
      throw err;
    }
  }
}

/** {@link RelayBackendFactory} for PostgreSQL. */
export const createPostgresRelayBackend = (
  opts: RelayBackendOptions<PostgresConnectionOptions>,
): PostgresRelayBackend => new PostgresRelayBackend(opts);
