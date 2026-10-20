import { EventEmitter } from 'events';
import {
  ConnectionOptions,
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
 * | `:mid` | string | message id counter (starts at the server time in µs) |
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
export class RedisRelayBackend extends EventEmitter implements IRelayBackend {
  readonly namespace: string;
  readonly initialInboxCursor = '0-0';

  private readonly prefix: string;
  private readonly baseKey: string;
  private readonly nodesKey: string;
  private readonly registryKey: string;
  private readonly nodeId?: string;
  private readonly skipVersionCheck: boolean;
  private readonly inboxMaxLength: number;
  private readonly connectionOpts: ConnectionOptions;
  private readonly connection: RedisConnection;
  private namespaceTouch?: Promise<void>;
  private namespaceExpiresAt = 0;
  /** Created on the first inbox read: getters alone need one connection. */
  private blockingConnection?: RedisConnection;
  private blockingConnectionPromise?: Promise<RedisConnection>;
  private interrupted = false;
  private closing?: Promise<void>;

  constructor(opts: RelayBackendOptions<ConnectionOptions>) {
    super();
    this.namespace = opts.namespace;
    this.prefix = opts.prefix ?? 'bull';
    this.baseKey = this.namespaceKey(opts.namespace);
    this.nodesKey = `${this.baseKey}:nodes`;
    this.registryKey = `${this.prefix}::relay:namespaces`;
    this.nodeId = opts.nodeId;
    const connOpts = opts.connection as any;
    this.skipVersionCheck =
      opts.skipVersionCheck === true ||
      !!(
        connOpts &&
        (connOpts.skipVersionCheck ||
          connOpts.options?.skipVersionCheck ||
          connOpts.options?.redisOptions?.skipVersionCheck)
      );
    this.inboxMaxLength = opts.inboxMaxLength ?? DEFAULT_INBOX_MAX_LENGTH;

    this.connectionOpts = opts.connection;
    this.connection = new RedisConnection(opts.connection, {
      shared: isRedisInstance(opts.connection),
      blocking: false,
      skipVersionCheck: this.skipVersionCheck,
    });
    this.forwardConnectionErrors(this.connection);
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
        await this.blockingConnection?.close(true).catch((): void => undefined);
        await this.connection.close();
      })();
    }
    return this.closing;
  }

  async registerNode(
    nodeId: string,
    leaseMs: number,
    info: RelayNodeInfo = {},
    inboxMaxLength = this.inboxMaxLength,
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
          inboxMaxLength,
        ]),
        nodeId,
      );
    } while (result === 0);
    this.touchNamespace(leaseMs);
  }

  async heartbeat(nodeId: string, leaseMs: number): Promise<boolean> {
    const alive = (await this.exec('relayHeartbeat', [nodeId, leaseMs])) === 1;
    if (alive) {
      this.touchNamespace(leaseMs);
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
      this.touchNamespace(opts.retainMs);
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
    let connection: RedisConnection;
    try {
      connection = await this.getBlockingConnection();
    } catch (err) {
      if (this.interrupted) {
        return { entries: [], cursor };
      }
      throw err;
    }
    const client = await connection.client;
    if (this.interrupted) {
      return { entries: [], cursor };
    }
    // Recovers an ioredis Cluster left with an empty node pool by an outage,
    // as for the workers' blocking reads.
    const read = () =>
      connection.runWithClusterRecovery(() =>
        client.runCommand(`relayReadInbox:${packageVersion}`, [
          this.nodesKey,
          this.baseKey,
          nodeId,
          cursor,
          opts.count,
        ]),
      );
    let result = await read();
    if (!result && opts.blockMs > 0 && !this.interrupted) {
      // Only use the blocking read as a wakeup. Fetching and marking the actual
      // batch must be atomic with publish-time trimming.
      await connection.runWithClusterRecovery(() =>
        client.xread([{ key: `${this.baseKey}:${nodeId}:inbox`, id: cursor }], {
          BLOCK: opts.blockMs,
          COUNT: 1,
        }),
      );
      if (this.interrupted) {
        return { entries: [], cursor };
      }
      result = await read();
    }
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
    const candidates: string[] = await client.runCommand(
      `relayGetNamespaces:${packageVersion}`,
      [this.registryKey],
    );
    // The registry only says until when a namespace may be in use (its nodes
    // can unregister and its retained messages be deleted earlier), so each
    // candidate is checked against its own keys.
    const used = await Promise.all(
      candidates.map(async namespace => {
        const baseKey = this.namespaceKey(namespace);
        return (
          (await client.runCommand(`relayGet:${packageVersion}`, [
            `${baseKey}:nodes`,
            baseKey,
            'used',
            0,
            -1,
            '',
            '',
          ])) === 1
        );
      }),
    );
    return candidates.filter((_, i) => used[i]);
  }

  async getNodeConnections(nodeId: string): Promise<RelayNodeConnection[]> {
    const client = await this.connection.client;
    // Adapter options do not consistently expose the selected database.
    const db = client.isCluster
      ? '0'
      : (await client.clientInfo()).match(/(?:^| )db=(\d+)/)?.[1];
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
      if (fields.name === name && fields.db === db) {
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
    this.blockingConnection?.close(true).catch((): void => undefined);
  }

  private getBlockingConnection(): Promise<RedisConnection> {
    if (!this.blockingConnectionPromise) {
      const promise = (async () => {
        const shared = isRedisInstance(this.connectionOpts);
        const client = await this.connection.client;
        // Closed meanwhile: a connection opened now would never be closed.
        if (this.interrupted) {
          throw new Error('Connection is closed.');
        }
        // Named after the node (CLIENT SETNAME, re-applied on reconnects) so
        // getNodeConnections can find it.
        const naming = this.nodeId
          ? { connectionName: this.inboxConnectionName(this.nodeId) }
          : {};
        const connection = new RedisConnection(
          shared
            ? client.duplicate({
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
        this.forwardConnectionErrors(connection);
        // Set before it's ready, so closing can stop it while it connects.
        this.blockingConnection = connection;
        try {
          await connection.client;
        } catch (err) {
          // Disposed of, so the next read starts over with a new connection.
          if (this.blockingConnection === connection) {
            this.blockingConnection = undefined;
          }
          await connection.close(true).catch((): void => undefined);
          throw err;
        }
        return connection;
      })();
      this.blockingConnectionPromise = promise;
      promise.catch(() => {
        if (this.blockingConnectionPromise === promise) {
          this.blockingConnectionPromise = undefined;
        }
      });
    }
    return this.blockingConnectionPromise;
  }

  private forwardConnectionErrors(connection: RedisConnection): void {
    connection.on('error', err => {
      if (this.listenerCount('error') > 0) {
        this.emit('error', err);
      }
    });
  }

  /** Base key of a namespace of this backend's prefix. */
  private namespaceKey(namespace: string) {
    return `${this.prefix}::relay:{${namespace}}`;
  }

  /** Redis client name of a node's inbox connection. */
  private inboxConnectionName(nodeId: string) {
    return `${Buffer.from(this.baseKey).toString('base64')}:${nodeId}`;
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
  private touchNamespace(forMs: number): void {
    this.namespaceExpiresAt = Math.max(
      this.namespaceExpiresAt,
      Date.now() + forMs,
    );
    this.startNamespaceTouch();
  }

  private startNamespaceTouch(): void {
    if (!this.namespaceTouch) {
      const requestedUntil = this.namespaceExpiresAt;
      const promise = this.refreshNamespace();
      this.namespaceTouch = promise;
      promise
        .finally(() => {
          if (this.namespaceTouch === promise) {
            this.namespaceTouch = undefined;
            if (!this.closing && this.namespaceExpiresAt > requestedUntil) {
              this.startNamespaceTouch();
            }
          }
        })
        .catch((): void => undefined);
    }
  }

  private async refreshNamespace(): Promise<void> {
    for (let attempt = 0; attempt < 3 && !this.closing; attempt++) {
      const expiresAt = this.namespaceExpiresAt;
      try {
        const client = await this.connection.client;
        await client.runCommand(`relayTouchNamespace:${packageVersion}`, [
          this.registryKey,
          this.namespace,
          Math.max(1, expiresAt - Date.now()),
        ]);
        return;
      } catch (err) {
        if (attempt === 2) {
          if (!this.closing && this.listenerCount('error') > 0) {
            this.emit('error', err);
          }
        } else {
          await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt));
        }
      }
    }
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
