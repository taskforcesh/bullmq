import {
  ConnectionOptions,
  IRedisClient,
  IRelayBackend,
  RelayBackendOptions,
  RelayInboxBatch,
  RelayInboxEntry,
  RelayPublishOptions,
  RelayPublishResult,
  RelaySubscribeResult,
} from '../interfaces';
import { isRedisInstance } from '../utils';
import { RedisConnection } from './redis-connection';
import { checkRelayResult } from './relay-errors';
import { version as packageVersion } from '../version';

const DEFAULT_INBOX_MAX_LENGTH = 10_000;

/**
 * Redis implementation of {@link IRelayBackend}. Every operation is one of the
 * `relay*` Lua scripts; this class only passes arguments and decodes results.
 *
 * Keys live under `{prefix}:relay:{namespace}`. On Redis Cluster, use a hash
 * tag in the prefix (as for queues) so they share one slot.
 *
 * Each node's inbox is a stream, read with a blocking `XREAD` on a dedicated
 * connection. Entries published while that connection is reconnecting are
 * read once it's back.
 */
export class RedisRelayBackend implements IRelayBackend {
  readonly namespace: string;
  readonly initialInboxCursor = '0-0';

  private readonly baseKey: string;
  private readonly nodesKey: string;
  private readonly inboxMaxLength: number;
  private readonly connection: RedisConnection;
  private readonly blockingConnection: RedisConnection;
  private closing?: Promise<void>;

  constructor(opts: RelayBackendOptions<ConnectionOptions>) {
    this.namespace = opts.namespace;
    this.baseKey = `${opts.prefix ?? 'bull'}:relay:${opts.namespace}`;
    this.nodesKey = `${this.baseKey}:nodes`;
    this.inboxMaxLength = opts.inboxMaxLength ?? DEFAULT_INBOX_MAX_LENGTH;

    const shared = isRedisInstance(opts.connection);
    this.connection = new RedisConnection(opts.connection, {
      shared,
      blocking: false,
      skipVersionCheck: opts.skipVersionCheck,
    });
    this.blockingConnection = new RedisConnection(
      shared ? (opts.connection as IRedisClient).duplicate() : opts.connection,
      {
        shared: false,
        blocking: true,
        skipVersionCheck: opts.skipVersionCheck,
      },
    );
  }

  async waitUntilReady(): Promise<void> {
    await Promise.all([this.connection.client, this.blockingConnection.client]);
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.closing = (async () => {
        await this.blockingConnection.close(true);
        await this.connection.close();
      })();
    }
    return this.closing;
  }

  async registerNode(nodeId: string, leaseMs: number): Promise<void> {
    checkRelayResult(
      await this.exec('relayRegisterNode', [nodeId, leaseMs]),
      nodeId,
    );
  }

  async heartbeat(nodeId: string, leaseMs: number): Promise<boolean> {
    return (await this.exec('relayHeartbeat', [nodeId, leaseMs])) === 1;
  }

  async unregisterNode(nodeId: string): Promise<boolean> {
    return (await this.exec('relayUnregisterNode', [nodeId])) === 1;
  }

  async sweep(limit: number): Promise<string[]> {
    return this.exec('relaySweep', [limit]);
  }

  async subscribe(
    nodeId: string,
    endpointId: string,
    pattern: string,
  ): Promise<RelaySubscribeResult> {
    const [added, mid, ts, data] = checkRelayResult(
      await this.exec('relaySubscribe', [nodeId, endpointId, pattern]),
      pattern,
    );
    return {
      added: added === 1,
      retained: mid ? { mid: String(mid), ts: Number(ts), data } : undefined,
    };
  }

  async unsubscribe(
    nodeId: string,
    endpointId: string,
    pattern: string,
  ): Promise<boolean> {
    return (
      (await this.exec('relayUnsubscribe', [nodeId, endpointId, pattern])) === 1
    );
  }

  async removeEndpoint(nodeId: string, endpointId: string): Promise<number> {
    return this.exec('relayRemoveEndpoint', [nodeId, endpointId]);
  }

  async publish(
    topic: string,
    data: string,
    opts: RelayPublishOptions,
  ): Promise<RelayPublishResult> {
    const [mid, nodes, endpoints] = checkRelayResult(
      await this.exec('relayPublish', [
        topic,
        data,
        opts.ts,
        opts.retainMs,
        opts.maxSize,
        this.inboxMaxLength,
      ]),
      topic,
    );
    return { mid: String(mid), nodes, endpoints };
  }

  async readInbox(
    nodeId: string,
    cursor: string,
    opts: { blockMs: number; count: number },
  ): Promise<RelayInboxBatch> {
    const client = await this.blockingConnection.client;
    // BLOCK 0 would wait forever; the contract's 0 means "don't wait".
    const result = await client.xread(
      [{ key: `${this.baseKey}:inbox:${nodeId}`, id: cursor }],
      opts.blockMs > 0
        ? { BLOCK: opts.blockMs, COUNT: opts.count }
        : { COUNT: opts.count },
    );
    if (!result) {
      return { entries: [], cursor };
    }
    const entries: RelayInboxEntry[] = [];
    let next = cursor;
    for (const [id, fields] of result[0][1] as [string, string[]][]) {
      next = id;
      const entry: Record<string, string> = {};
      for (let i = 0; i + 1 < fields.length; i += 2) {
        entry[fields[i]] = fields[i + 1];
      }
      entries.push({
        kind: entry.k as RelayInboxEntry['kind'],
        topic: entry.t,
        mid: entry.m,
        ts: Number(entry.ts),
        data: entry.d,
        endpoints: entry.e ? entry.e.split(',') : [],
      });
    }
    return { entries, cursor: next };
  }

  interruptInbox(): void {
    this.blockingConnection.client
      .then(client => client.disconnect())
      .catch((): void => undefined);
  }

  private async exec(command: string, args: (string | number)[]) {
    const client = await this.connection.client;
    return client.runCommand(`${command}:${packageVersion}`, [
      this.nodesKey,
      this.baseKey,
      ...args,
    ]);
  }
}

/** The default {@link RelayBackendFactory}: Redis. */
export const createRedisRelayBackend = (
  opts: RelayBackendOptions<ConnectionOptions>,
): RedisRelayBackend => new RedisRelayBackend(opts);
