import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import {
  ConnectionOptions,
  IRelayBackend,
  RelayBackendFactory,
  RelayCounts,
  RelayInboxBatch,
  RelayInboxEntry,
  RelayNodeConnection,
  RelayNodeState,
  RelayPatternState,
  RelayPublishResult,
  RelayRetainedState,
  RelaySubscriptionFilter,
  RelaySubscriptionState,
} from '../interfaces';
import { createRedisRelayBackend } from './redis-relay-backend';
import { version as packageVersion } from '../version';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_NAME_LENGTH = 256;

export interface RelayOptions<C = ConnectionOptions> {
  /** Connection to the datastore (Redis by default, see `backend`). */
  connection: C;
  /** Key prefix (Redis only). Default `bull`. */
  prefix?: string;
  /** Isolates relays sharing a datastore. Default `default`. */
  namespace?: string;
  /** Unique id of this node. Default: random. */
  nodeId?: string;
  /**
   * Human-readable name of this node (e.g. the service it belongs to), shown
   * by dashboards. Up to 256 characters.
   */
  name?: string;
  /**
   * How long this node stays registered without a heartbeat (ms). After
   * that, any node may sweep it with its subscriptions. Default 30000.
   */
  leaseDuration?: number;
  /** Default `leaseDuration / 3`, rounded down to at least 1 ms. */
  heartbeatInterval?: number;
  /** How often this node sweeps expired nodes (ms). Default `leaseDuration`. */
  sweepInterval?: number;
  /** Max serialized message size (bytes). Default 512 KiB. */
  maxMessageSize?: number;
  /**
   * Max number of unread messages kept in this node's inbox. When a slow node
   * falls further behind, its oldest unread messages are dropped. Enforced on
   * publish (Redis) and by safe inbox trimming. Default 10000.
   */
  inboxMaxLength?: number;
  /**
   * Emit `'lag'` when this node has at least this many unread messages,
   * checked after inbox batches are read and on heartbeat. Must not exceed
   * `inboxMaxLength`.
   * Default `inboxMaxLength / 2`.
   */
  lagThreshold?: number;
  /** Max time an inbox read waits for new messages (ms). Default 5000. */
  blockTimeout?: number;
  /** Datastore backend. Default: Redis. */
  backend?: RelayBackendFactory<C>;
  skipVersionCheck?: boolean;
}

export interface RelayMessage<T = unknown> {
  topic: string;
  data: T;
  /** Message id, unique and increasing per namespace. */
  mid: string;
  /** Publish timestamp (ms). */
  ts: number;
  /** True when delivered from the topic's retained value on subscribe. */
  retained: boolean;
}

export type RelayListener<T = unknown> = (
  message: RelayMessage<T>,
) => void | Promise<void>;

export interface RelayPublishOpts {
  /**
   * Keep this message as the topic's retained value for this long (ms).
   * Must be a non-negative safe integer; 0 disables retention.
   */
  retain?: number;
}

export interface RelaySubscription {
  readonly pattern: string;
  unsubscribe(): Promise<void>;
}

interface Endpoint {
  pattern: string;
  listener: RelayListener<any>;
  active: boolean;
  /** Live messages received while the subscription is being set up. */
  pending?: RelayMessage<string>[];
  removing?: Promise<void>;
}

/**
 * Routes messages between the nodes of a fleet: any process can publish on a
 * topic, and every subscription matching it receives the message, wherever it
 * runs.
 *
 * The routing logic (topic grammar, matching, subscriptions, node liveness and
 * inboxes) lives in Lua scripts (Redis) or SQL functions (PostgreSQL) behind
 * {@link IRelayBackend}; this class only runs timers, reads its inbox and
 * calls listeners.
 *
 * Topics are dot-separated keypaths (`queues.emails.jobs.42.progress`).
 * Patterns may use `*` (one segment) and `>` (one or more trailing segments).
 *
 * Events: `'error'` (Error), `'recovered'` (the node re-registered after its
 * lease expired), `'swept'` (string[] of removed node ids), `'lag'` (number
 * of unread messages, when it reaches `lagThreshold`).
 *
 * @experimental The API may change in minor releases while the relay is
 * completed.
 */
export class Relay<C = ConnectionOptions> extends EventEmitter {
  readonly nodeId: string;
  readonly namespace: string;

  private readonly backend: IRelayBackend;
  private readonly leaseDuration: number;
  private readonly maxMessageSize: number;
  private readonly blockTimeout: number;
  private readonly inboxMaxLength: number;
  private readonly lagThreshold: number;
  private readonly endpoints = new Map<string, Endpoint>();
  private readonly ready: Promise<void>;
  private cursor: string;
  private heartbeatTimer?: NodeJS.Timeout;
  private sweepTimer?: NodeJS.Timeout;
  private loop?: Promise<void>;
  private heartbeating?: Promise<void>;
  private backlogChecking?: Promise<void>;
  private batchInFlight = false;
  private sweeping?: Promise<void>;
  private recoveryPending = false;
  /** Incremented when a recovery replaces the node's registration. */
  private registration = 0;
  private connected = false;
  private cancelStart!: () => void;
  private readonly startCancelled = new Promise<void>(resolve => {
    this.cancelStart = resolve;
  });
  private closing?: Promise<void>;

  constructor(private readonly opts: RelayOptions<C>) {
    super();
    if (!opts || !opts.connection) {
      throw new Error('Relay requires a connection');
    }
    this.namespace = opts.namespace ?? 'default';
    this.nodeId = opts.nodeId ?? randomUUID().replace(/-/g, '');
    for (const [name, value] of [
      ['namespace', this.namespace],
      ['nodeId', this.nodeId],
    ]) {
      if (!ID_RE.test(value)) {
        throw new Error(`Invalid relay ${name}: ${value}`);
      }
    }
    if (
      opts.name !== undefined &&
      (typeof opts.name !== 'string' || opts.name.length > MAX_NAME_LENGTH)
    ) {
      throw new Error(`Invalid relay name: ${opts.name}`);
    }
    this.leaseDuration = opts.leaseDuration ?? 30_000;
    for (const name of [
      'leaseDuration',
      'heartbeatInterval',
      'sweepInterval',
      'blockTimeout',
      'inboxMaxLength',
      'lagThreshold',
      'maxMessageSize',
    ] as const) {
      const value = opts[name];
      if (
        value !== undefined &&
        (!Number.isInteger(value) || value <= 0 || value > 2_147_483_647)
      ) {
        throw new Error(`Invalid relay ${name}: ${value}`);
      }
    }
    this.maxMessageSize = opts.maxMessageSize ?? 512 * 1024;
    this.blockTimeout = opts.blockTimeout ?? 5_000;
    this.inboxMaxLength = opts.inboxMaxLength ?? 10_000;
    this.lagThreshold =
      opts.lagThreshold ?? Math.max(1, Math.floor(this.inboxMaxLength / 2));
    if (this.lagThreshold > this.inboxMaxLength) {
      throw new Error('Relay lagThreshold must not exceed inboxMaxLength');
    }

    const factory = (opts.backend ??
      createRedisRelayBackend) as RelayBackendFactory<C>;
    this.backend = factory({
      connection: opts.connection,
      namespace: this.namespace,
      nodeId: this.nodeId,
      prefix: opts.prefix,
      inboxMaxLength: this.inboxMaxLength,
      skipVersionCheck: opts.skipVersionCheck,
    });
    if (this.backend instanceof EventEmitter) {
      this.backend.on('error', err => this.emitError(err));
    }
    this.cursor = this.backend.initialInboxCursor;

    this.ready = this.start();
    this.ready.catch(err => this.emitError(err));
  }

  waitUntilReady(): Promise<void> {
    return this.ready;
  }

  /**
   * Subscribes to a topic or pattern. For an exact topic, its retained
   * message (if any) is delivered first, with `retained: true`.
   */
  async subscribe<T = unknown>(
    pattern: string,
    listener: RelayListener<T>,
  ): Promise<RelaySubscription> {
    await this.ready;
    this.assertOpen();
    const endpointId = randomUUID().replace(/-/g, '');
    const endpoint: Endpoint = {
      pattern,
      listener,
      active: true,
      pending: [],
    };
    // Registered first, so live messages that arrive while subscribing are
    // buffered, then delivered after the retained one.
    this.endpoints.set(endpointId, endpoint);
    try {
      const { retained } = await this.backend.subscribe(
        this.nodeId,
        endpointId,
        pattern,
      );
      this.assertOpen();
      const pending = endpoint.pending ?? [];
      endpoint.pending = undefined;
      if (retained) {
        this.deliver(endpoint, {
          topic: pattern,
          mid: retained.mid,
          ts: retained.ts,
          data: retained.data,
          retained: true,
        });
      }
      // Skips live copies of the retained message (or older ones). Buffered
      // messages are not compared with each other: publishes on different
      // topics may commit out of message id order.
      const cutoff = retained ? BigInt(retained.mid) : BigInt(0);
      for (const message of pending) {
        if (BigInt(message.mid) > cutoff) {
          this.deliver(endpoint, message);
        }
      }
    } catch (err) {
      endpoint.pending = undefined;
      endpoint.active = false;
      try {
        await this.removeEndpoint(endpointId, endpoint);
      } catch (cleanupError) {
        this.recoveryPending = true;
        this.emitError(cleanupError);
      }
      throw err;
    }
    return {
      pattern,
      unsubscribe: async () => {
        endpoint.active = false;
        await this.removeEndpoint(endpointId, endpoint);
      },
    };
  }

  /**
   * Publishes `data` (any JSON-serializable value) on a concrete topic.
   */
  async publish(
    topic: string,
    data: unknown,
    opts: RelayPublishOpts = {},
  ): Promise<RelayPublishResult> {
    await this.ready;
    this.assertOpen();
    const retainMs = opts.retain ?? 0;
    if (!Number.isSafeInteger(retainMs) || retainMs < 0) {
      throw new Error(`Invalid relay retain: ${retainMs}`);
    }
    const serialized = JSON.stringify(data === undefined ? null : data);
    return this.backend.publish(topic, serialized, {
      ts: Date.now(),
      retainMs,
      maxSize: this.maxMessageSize,
    });
  }

  /**
   * Deletes the retained message of a topic: new subscribers no longer get
   * it. Returns false if the topic had no retained message.
   */
  async deleteRetained(topic: string): Promise<boolean> {
    await this.ready;
    this.assertOpen();
    return this.backend.deleteRetained(topic);
  }

  /** Totals of this namespace, for dashboards. */
  async getCounts(): Promise<RelayCounts> {
    await this.ready;
    return this.backend.getCounts();
  }

  /**
   * Nodes of this namespace, in registration order. `start` and `end` are
   * inclusive positions; an `end` of -1 means "to the end".
   */
  async getNodes(start = 0, end = -1): Promise<RelayNodeState[]> {
    await this.ready;
    return this.backend.getNodes(...checkRange(start, end));
  }

  /**
   * Subscriptions of this namespace (or of a node or pattern only), ordered
   * by node and endpoint (or pattern), then pattern (or node and endpoint).
   */
  async getSubscriptions(
    filter?: RelaySubscriptionFilter,
    start = 0,
    end = -1,
  ): Promise<RelaySubscriptionState[]> {
    await this.ready;
    return this.backend.getSubscriptions(filter, ...checkRange(start, end));
  }

  /** Subscribed patterns, ordered by pattern, with their subscriptions. */
  async getPatterns(start = 0, end = -1): Promise<RelayPatternState[]> {
    await this.ready;
    return this.backend.getPatterns(...checkRange(start, end));
  }

  /** Retained messages, by expiry (the data is as serialized). */
  async getRetained(start = 0, end = -1): Promise<RelayRetainedState[]> {
    await this.ready;
    return this.backend.getRetained(...checkRange(start, end));
  }

  /**
   * A node's inbox connection (this node's by default), as the datastore sees
   * it: its address and how long it has been open and idle. Empty when the
   * node isn't connected. Lists every client of the datastore: use it on
   * demand, not on a timer.
   */
  async getNodeConnections(
    nodeId = this.nodeId,
  ): Promise<RelayNodeConnection[]> {
    await this.ready;
    if (!ID_RE.test(nodeId)) {
      throw new Error(`Invalid relay nodeId: ${nodeId}`);
    }
    return this.backend.getNodeConnections(nodeId);
  }

  /** Namespaces in use in the datastore (or Redis prefix). */
  async getNamespaces(): Promise<string[]> {
    await this.ready;
    return this.backend.getNamespaces();
  }

  /**
   * Stops this node and unregisters it, removing its subscriptions.
   */
  close(): Promise<void> {
    if (!this.closing) {
      this.closing = this.stop();
    }
    return this.closing;
  }

  private async start(): Promise<void> {
    // close() cancels a startup still waiting for the datastore.
    await Promise.race([this.backend.waitUntilReady(), this.startCancelled]);
    if (this.closing) {
      return;
    }
    this.connected = true;
    await this.register();
    if (this.closing) {
      return;
    }

    const heartbeatInterval =
      this.opts.heartbeatInterval ??
      Math.max(1, Math.floor(this.leaseDuration / 3));
    this.heartbeatTimer = setInterval(
      () => this.heartbeat(true).catch(err => this.emitError(err)),
      heartbeatInterval,
    );
    this.sweepTimer = setInterval(
      () => this.sweep().catch(err => this.emitError(err)),
      this.opts.sweepInterval ?? this.leaseDuration,
    );
    this.loop = this.readLoop();
  }

  private async stop(): Promise<void> {
    clearInterval(this.heartbeatTimer);
    clearInterval(this.sweepTimer);
    if (!this.connected) {
      // Still connecting (possibly retrying forever): never registered, so
      // there is nothing to unregister. Cancel startup and close directly.
      this.cancelStart();
      this.endpoints.clear();
      await this.backend.close();
      return;
    }
    try {
      await this.ready;
    } catch {
      // closing anyway
    }
    this.endpoints.clear();
    this.backend.interruptInbox();
    await this.loop?.catch((): void => undefined);
    await this.heartbeating?.catch((): void => undefined);
    await this.sweeping?.catch((): void => undefined);
    try {
      await this.backend.unregisterNode(this.nodeId);
    } catch (err) {
      this.emitError(err);
    }
    await this.backend.close();
  }

  private heartbeat(trimInbox = false): Promise<void> {
    // A slow datastore must not pile up overlapping heartbeats (or run two
    // recoveries at once): skip the tick while the previous one runs.
    if (this.closing) {
      return Promise.resolve();
    }
    if (this.heartbeating) {
      return this.heartbeating;
    }
    this.heartbeating = (async () => {
      const alive = await this.backend.heartbeat(
        this.nodeId,
        this.leaseDuration,
      );
      if ((!alive || this.recoveryPending) && !this.closing) {
        await this.recover();
      }
      if (trimInbox && !this.closing) {
        await this.checkBacklog();
      }
    })().finally(() => {
      this.heartbeating = undefined;
    });
    return this.heartbeating;
  }

  /**
   * Removes consumed inbox entries, caps the inbox at `inboxMaxLength`, and
   * emits `'lag'` when the unread backlog reaches `lagThreshold`.
   */
  private async checkBacklog(): Promise<void> {
    if (this.closing || this.batchInFlight) {
      return;
    }
    if (!this.backlogChecking) {
      this.backlogChecking = (async () => {
        const backlog = await this.backend.trimInbox(
          this.nodeId,
          this.cursor,
          this.inboxMaxLength,
        );
        if (backlog >= this.lagThreshold) {
          this.emit('lag', backlog);
        }
      })().finally(() => {
        this.backlogChecking = undefined;
      });
    }
    return this.backlogChecking;
  }

  /**
   * The node's lease expired or it was swept: register again and restore
   * its subscriptions. Retained messages are not delivered again. If it fails
   * part way, the next heartbeat retries it.
   */
  private async recover(): Promise<void> {
    this.recoveryPending = true;
    this.registration++;
    await this.register();
    let renewalError: unknown;
    let renewal: Promise<void> | undefined;
    const renewLease = () => {
      if (!renewal && !this.closing && !renewalError) {
        renewal = this.backend
          .heartbeat(this.nodeId, this.leaseDuration)
          .then(alive => {
            if (!alive) {
              throw new Error('Relay node lease expired during recovery');
            }
          })
          .catch(err => {
            renewalError ??= err;
          })
          .finally(() => {
            renewal = undefined;
          });
      }
      return renewal;
    };
    const renewalTimer = setInterval(
      () => void renewLease(),
      Math.max(1, Math.floor(this.leaseDuration / 3)),
    );
    try {
      for (const [endpointId, endpoint] of this.endpoints) {
        if (renewalError) {
          throw renewalError;
        }
        if (!endpoint.active) {
          await this.removeEndpoint(endpointId, endpoint);
          continue;
        }
        await this.backend.subscribe(this.nodeId, endpointId, endpoint.pattern);
        if (!endpoint.active) {
          await this.removeEndpoint(endpointId, endpoint);
        }
      }
      if (renewal) {
        await renewal;
      }
      if (renewalError) {
        throw renewalError;
      }
      this.recoveryPending = false;
      this.emit('recovered');
    } finally {
      clearInterval(renewalTimer);
    }
  }

  private register(): Promise<void> {
    return this.backend.registerNode(
      this.nodeId,
      this.leaseDuration,
      {
        name: this.opts.name,
        host: hostname(),
        pid: process.pid,
        version: packageVersion,
      },
      this.inboxMaxLength,
    );
  }

  private removeEndpoint(
    endpointId: string,
    endpoint: Endpoint,
  ): Promise<void> {
    if (this.closing) {
      return Promise.resolve();
    }
    if (!endpoint.removing) {
      endpoint.removing = this.backend
        .removeEndpoint(this.nodeId, endpointId)
        .then(() => {
          if (!endpoint.active) {
            this.endpoints.delete(endpointId);
          }
        })
        .finally(() => {
          endpoint.removing = undefined;
        });
    }
    return endpoint.removing;
  }

  private sweep(): Promise<void> {
    if (this.closing || this.sweeping) {
      return Promise.resolve();
    }
    this.sweeping = (async () => {
      const removed = await this.backend.sweep(100);
      if (removed.length > 0) {
        this.emit('swept', removed);
      }
    })().finally(() => {
      this.sweeping = undefined;
    });
    return this.sweeping;
  }

  private async readLoop(): Promise<void> {
    // A batch fetched but not dispatched yet. It is kept when the heartbeat
    // before its dispatch fails: the datastore already counts its entries as
    // in flight, so trimming may remove them without counting them as dropped.
    let fetched: { batch: RelayInboxBatch; registration: number } | undefined;
    while (!this.closing) {
      try {
        if (!fetched) {
          if (this.backlogChecking) {
            await this.backlogChecking;
          }
          const registration = this.registration;
          const batch = await this.backend.readInbox(this.nodeId, this.cursor, {
            blockMs: this.blockTimeout,
            count: 100,
          });
          fetched = { batch, registration };
        }
        const { batch, registration } = fetched;
        this.batchInFlight = batch.entries.length > 0;
        if (batch.entries.length > 0 && !this.closing) {
          // A lease may have expired while reading. Recover before listeners
          // consume messages, so they can invalidate state after a routing gap.
          await this.heartbeat();
        }
        if (this.closing) {
          break;
        }
        fetched = undefined;
        // If a recovery started during or after this read, the batch may belong
        // to the replaced registration, so it must not overwrite state reset
        // on 'recovered'. Read again without acknowledging it: the replaced
        // registration's entries are gone, the new one's are read again.
        if (registration === this.registration) {
          this.cursor = batch.cursor;
          for (const entry of batch.entries) {
            this.dispatch(entry);
          }
        }
        this.batchInFlight = false;
        if (batch.entries.length > 0) {
          await this.checkBacklog();
        }
      } catch (err) {
        this.batchInFlight = false;
        if (this.closing) {
          break;
        }
        this.emitError(err);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } finally {
        this.batchInFlight = false;
      }
    }
  }

  private dispatch(entry: RelayInboxEntry): void {
    // Kinds added by newer versions are not for this node.
    if (entry.kind !== 'msg') {
      return;
    }
    for (const endpointId of entry.endpoints) {
      const endpoint = this.endpoints.get(endpointId);
      if (endpoint?.active) {
        const message: RelayMessage<string> = {
          topic: entry.topic,
          mid: entry.mid,
          ts: entry.ts,
          data: entry.data,
          retained: false,
        };
        if (endpoint.pending) {
          endpoint.pending.push(message);
        } else {
          this.deliver(endpoint, message);
        }
      }
    }
  }

  private deliver(endpoint: Endpoint, message: RelayMessage<string>): void {
    if (!endpoint.active) {
      return;
    }
    let data: unknown;
    try {
      data = JSON.parse(message.data);
    } catch (err) {
      this.emitError(err);
      return;
    }
    try {
      const result = endpoint.listener({ ...message, data });
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(err => this.emitError(err));
      }
    } catch (err) {
      this.emitError(err);
    }
  }

  private assertOpen(): void {
    if (this.closing) {
      throw new Error('Relay is closed');
    }
  }

  private emitError(err: unknown): void {
    if (this.listenerCount('error') > 0) {
      this.emit('error', err);
    }
  }
}

function checkRange(start: number, end: number): [number, number] {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < -1
  ) {
    throw new Error(`Invalid relay range: ${start}..${end}`);
  }
  return [start, end];
}
