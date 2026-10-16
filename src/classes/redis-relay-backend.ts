import {
  ConnectionOptions,
  IRedisClient,
  IRelayBackend,
  RelayBackendOptions,
  RelayCounts,
  RelayInboxBatch,
  RelayInboxEntry,
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
import { isRedisInstance, isRedisVersionLowerThan } from '../utils';
import { RedisConnection } from './redis-connection';
import { checkRelayResult } from './relay-errors';
import { version as packageVersion } from '../version';

const DEFAULT_INBOX_MAX_LENGTH = 10_000;

/** Minimum Redis version for the relay (queues still run on 5.0). */
export const RELAY_MINIMUM_REDIS_VERSION = '6.2.0';

/**
 * Version of the relay's Redis data layout. Changes within a layout version
 * are additive only (new keys, fields or entry kinds that older nodes
 * ignore); anything else needs a new version, and nodes of different
 * versions refuse to share a namespace.
 */
export const RELAY_LAYOUT_VERSION = '1';

/**
 * Redis implementation of {@link IRelayBackend}. Every operation is one of the
 * `relay*` Lua scripts; this class only passes arguments and decodes results.
 *
 * Keys of a namespace live under `{prefix}::relay:{<namespace>}`:
 *
 * - The empty segment after the prefix keeps the relay out of the queues'
 *   keyspace: every queue key (jobs included) is `{prefix}:{queue}:...` with
 *   a non-empty queue name, so no queue (not even one named "relay") nor any
 *   of its jobs can ever collide with a relay key.
 * - Every key ends with a fixed word that is not a queue key suffix, never
 *   with a node id or topic, so tools that discover queues by key suffix
 *   (`*:*:id`, `*:*:meta`) never mistake relay keys for queues.
 * - The namespace is a hash tag, so on Redis Cluster each namespace is one
 *   slot (the unit of scale) whatever the prefix.
 *
 * | Key | Type | Content |
 * | --- | --- | --- |
 * | `:layout` | hash | `layout` version |
 * | `:nodes` | sorted set | node → lease deadline |
 * | `:started` | sorted set | node → registration time |
 * | `:{id}:node` | hash | `info`, `hb`, `backlog`, `dropped`; expires with the lease |
 * | `:{id}:inbox` | stream | the node's messages; expires with the lease |
 * | `:subs` | sorted set | subscription index (see `includes/relayIndex.lua`) |
 * | `:cleanup` | sorted set | removed nodes whose subscriptions are being pruned |
 * | `:retained` | sorted set | topic → expiry |
 * | `:{topic}:ret` | hash | retained message (`m`, `ts`, `d`) |
 * | `:mid` | string | message id counter |
 *
 * Every key expires on its own when the namespace has no live node (and no
 * retained message), so nothing is left behind even if no node sweeps it.
 * `{prefix}::relay:namespaces` (sorted set: namespace → in use until) lists
 * the namespaces in use, and expires on its own as well.
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
  private readonly registryKey: string;
  private readonly nodeId?: string;
  private readonly skipVersionCheck: boolean;
  private readonly inboxMaxLength: number;
  private readonly connectionOpts: ConnectionOptions;
  private readonly connection: RedisConnection;
  /** Created on the first inbox read: getters alone need one connection. */
  private blockingConnection?: RedisConnection;
  private interrupted = false;
  private closing?: Promise<void>;

  constructor(opts: RelayBackendOptions<ConnectionOptions>) {
    this.namespace = opts.namespace;
    const prefix = opts.prefix ?? 'bull';
    this.baseKey = `${prefix}::relay:{${opts.namespace}}`;
    this.nodesKey = `${this.baseKey}:nodes`;
    this.registryKey = `${prefix}::relay:namespaces`;
    this.nodeId = opts.nodeId;
    this.skipVersionCheck = opts.skipVersionCheck === true;
    this.inboxMaxLength = opts.inboxMaxLength ?? DEFAULT_INBOX_MAX_LENGTH;

    this.connectionOpts = opts.connection;
    this.connection = new RedisConnection(opts.connection, {
      shared: isRedisInstance(opts.connection),
      blocking: false,
      skipVersionCheck: opts.skipVersionCheck,
    });
  }

  async waitUntilReady(): Promise<void> {
    await this.connection.client;
    if (
      !this.skipVersionCheck &&
      isRedisVersionLowerThan(
        this.connection.redisVersion,
        RELAY_MINIMUM_REDIS_VERSION,
        this.connection.databaseType,
      )
    ) {
      throw new Error(
        `The relay requires Redis ${RELAY_MINIMUM_REDIS_VERSION} or newer. ` +
          `Current: ${this.connection.redisVersion}`,
      );
    }
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.closing = (async () => {
        this.interrupted = true;
        await this.blockingConnection?.close(true);
        await this.connection.close();
      })();
    }
    return this.closing;
  }

  async registerNode(
    nodeId: string,
    leaseMs: number,
    info: RelayNodeInfo = {},
  ): Promise<void> {
    // Reusing an expired/removed ID must finish its old indexes before it can
    // receive messages again. Each call yields Redis after a bounded batch.
    let result: number;
    do {
      result = checkRelayResult(
        await this.exec('relayRegisterNode', [
          nodeId,
          leaseMs,
          JSON.stringify(info),
          RELAY_LAYOUT_VERSION,
        ]),
        nodeId,
      );
    } while (result === 0);
    await this.touchNamespace(leaseMs);
  }

  async heartbeat(nodeId: string, leaseMs: number): Promise<boolean> {
    const alive = (await this.exec('relayHeartbeat', [nodeId, leaseMs])) === 1;
    if (alive) {
      await this.touchNamespace(leaseMs);
    }
    return alive;
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
    if (opts.retainMs > 0) {
      await this.touchNamespace(opts.retainMs);
    }
    return { mid: String(mid), nodes, endpoints };
  }

  async deleteRetained(topic: string): Promise<boolean> {
    return (
      checkRelayResult(
        await this.exec('relayDeleteRetained', [topic]),
        topic,
      ) === 1
    );
  }

  async readInbox(
    nodeId: string,
    cursor: string,
    opts: { blockMs: number; count: number },
  ): Promise<RelayInboxBatch> {
    if (this.interrupted) {
      return { entries: [], cursor };
    }
    const client = await this.getBlockingConnection().client;
    // BLOCK 0 would wait forever; the contract's 0 means "don't wait".
    const result = await client.xread(
      [{ key: `${this.baseKey}:${nodeId}:inbox`, id: cursor }],
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

  async trimInbox(
    nodeId: string,
    cursor: string,
    maxLength: number,
  ): Promise<number> {
    return this.exec('relayTrimInbox', [nodeId, cursor, maxLength]);
  }

  async getCounts(): Promise<RelayCounts> {
    const [nodes, subscriptions, patterns, retained] = await this.get('counts');
    return { nodes, subscriptions, patterns, retained };
  }

  async getNodes(start: number, end: number): Promise<RelayNodeState[]> {
    const rows = await this.get('nodes', start, end);
    return rows.map(
      ([id, registeredAt, leaseUntil, info, hb, backlog, dropped, subs]: [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        number,
      ]) => ({
        id,
        info: info ? JSON.parse(info) : {},
        registeredAt: Number(registeredAt),
        leaseUntil: Number(leaseUntil),
        lastHeartbeat: hb ? Number(hb) : undefined,
        backlog: Number(backlog),
        dropped: Number(dropped),
        subscriptions: subs,
      }),
    );
  }

  async getSubscriptions(
    filter: RelaySubscriptionFilter | undefined,
    start: number,
    end: number,
  ): Promise<RelaySubscriptionState[]> {
    const [kind, value] =
      filter && 'nodeId' in filter
        ? ['node', filter.nodeId]
        : filter && 'pattern' in filter
          ? ['pattern', filter.pattern]
          : ['', ''];
    const rows = await this.get('subscriptions', start, end, kind, value);
    return rows.map(([nodeId, endpointId, pattern]: string[]) => ({
      nodeId,
      endpointId,
      pattern,
    }));
  }

  async getPatterns(start: number, end: number): Promise<RelayPatternState[]> {
    const rows = await this.get('patterns', start, end);
    return rows.map(([pattern, subscriptions]: [string, number]) => ({
      pattern,
      subscriptions,
    }));
  }

  async getRetained(start: number, end: number): Promise<RelayRetainedState[]> {
    const rows = await this.get('retained', start, end);
    return rows.map(([topic, expiresAt, mid, ts, data]: string[]) => ({
      topic,
      expiresAt: Number(expiresAt),
      mid: String(mid),
      ts: Number(ts),
      data,
    }));
  }

  async getNamespaces(): Promise<string[]> {
    const client = await this.connection.client;
    return client.runCommand(`relayGetNamespaces:${packageVersion}`, [
      this.registryKey,
    ]);
  }

  async getNodeConnections(nodeId: string): Promise<RelayNodeConnection[]> {
    const client = await this.connection.client;
    // Every node of a cluster: the connection may be to any of them.
    const lists: string[] =
      client.isCluster && typeof client.nodes === 'function'
        ? await Promise.all(
            (client.nodes() || []).map((node: any) =>
              typeof node.clientList === 'function'
                ? node.clientList()
                : node.client('LIST'),
            ),
          )
        : [await client.clientList()];

    const name = this.inboxConnectionName(nodeId);
    const connections: RelayNodeConnection[] = [];
    for (const line of lists.join('\n').split('\n')) {
      const fields: Record<string, string> = {};
      for (const pair of line.trim().split(' ')) {
        const eq = pair.indexOf('=');
        if (eq > 0) {
          fields[pair.slice(0, eq)] = pair.slice(eq + 1);
        }
      }
      if (fields.name === name) {
        connections.push({
          address: fields.addr,
          age: Number(fields.age),
          idle: Number(fields.idle),
        });
      }
    }
    return connections;
  }

  interruptInbox(): void {
    this.interrupted = true;
    this.blockingConnection?.client
      .then(client => client.disconnect())
      .catch((): void => undefined);
  }

  private getBlockingConnection(): RedisConnection {
    if (!this.blockingConnection) {
      const shared = isRedisInstance(this.connectionOpts);
      // Named after the node (CLIENT SETNAME, re-applied on reconnects) so
      // getNodeConnections can find it.
      const naming = this.nodeId
        ? { connectionName: this.inboxConnectionName(this.nodeId) }
        : {};
      this.blockingConnection = new RedisConnection(
        shared
          ? (this.connectionOpts as IRedisClient).duplicate({
              maxRetriesPerRequest: null,
              ...naming,
            })
          : { ...(this.connectionOpts as object), ...naming },
        {
          shared: false,
          blocking: true,
          skipVersionCheck: this.skipVersionCheck,
        },
      );
    }
    return this.blockingConnection;
  }

  /** Redis client name of a node's inbox connection. */
  private inboxConnectionName(nodeId: string) {
    return `${this.baseKey}:${nodeId}`;
  }

  private get(
    view: string,
    start = 0,
    end = -1,
    filter = '',
    value = '',
  ): Promise<any[]> {
    return this.exec('relayGet', [view, start, end, filter, value]);
  }

  /**
   * Lists the namespace in the prefix's registry. The registry is outside the
   * namespace's hash tag, so this is a call of its own.
   */
  private async touchNamespace(forMs: number): Promise<void> {
    const client = await this.connection.client;
    await client.runCommand(`relayTouchNamespace:${packageVersion}`, [
      this.registryKey,
      this.namespace,
      forMs,
    ]);
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
