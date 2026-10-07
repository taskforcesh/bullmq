import {
  IRelayBackend,
  RelayBackendOptions,
  RelayInboxBatch,
  RelayPublishOptions,
  RelayPublishResult,
  RelaySubscribeResult,
} from '../interfaces';
import { RelayError } from '../classes/relay-errors';
import { PgListenClient, PgNotification, PgQueryResult } from './pg-types';
import {
  PostgresConnection,
  PostgresConnectionOptions,
} from './postgres-connection';
import { loadCommandSql } from './sql-loader';

const RELAY_CHANNEL = 'bullmq_relay';

/**
 * PostgreSQL implementation of {@link IRelayBackend}. Every operation is one of
 * the `relay_*` SQL functions (migration `0004_relay`); this class only passes
 * arguments and decodes rows.
 *
 * Each node's inbox is a table, read after a `NOTIFY` on the `bullmq_relay`
 * channel (or after the wait times out, so a missed notification only delays
 * delivery). Entries are acknowledged by id, which never skips a row whose
 * transaction committed late.
 */
export class PostgresRelayBackend implements IRelayBackend {
  readonly namespace: string;
  readonly initialInboxCursor = '';

  private readonly connection: PostgresConnection;
  private listening = false;
  private cancelWait?: () => void;
  private closing?: Promise<void>;

  constructor(opts: RelayBackendOptions<PostgresConnectionOptions>) {
    this.namespace = opts.namespace;
    this.connection = new PostgresConnection(opts.connection);
    this.connection.on('listenerinvalidated', () => {
      this.listening = false;
      this.cancelWait?.();
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

  async registerNode(nodeId: string, leaseMs: number): Promise<void> {
    await this.run('relay_register_node', [this.namespace, nodeId, leaseMs]);
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

  async unsubscribe(
    nodeId: string,
    endpointId: string,
    pattern: string,
  ): Promise<boolean> {
    const { rows } = await this.run('relay_unsubscribe', [
      this.namespace,
      nodeId,
      endpointId,
      pattern,
    ]);
    return rows[0].removed;
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
      if (rows.length === 0 && !notified && opts.blockMs > 0 && !this.closing) {
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
        if (!this.closing) {
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

  interruptInbox(): void {
    this.cancelWait?.();
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
