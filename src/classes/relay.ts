import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
  ConnectionOptions,
  IRelayBackend,
  RelayBackendFactory,
  RelayInboxEntry,
  RelayPublishResult,
} from '../interfaces';
import { createRedisRelayBackend } from './redis-relay-backend';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

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
  /** Approximate max inbox length per node (Redis only). Default 10000. */
  inboxMaxLength?: number;
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
  /** Keep this message as the topic's retained value for this long (ms). */
  retain?: number;
}

export interface RelaySubscription {
  readonly pattern: string;
  unsubscribe(): Promise<void>;
}

interface Endpoint {
  pattern: string;
  listener: RelayListener<any>;
  lastMid: number;
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
 * lease expired), `'swept'` (string[] of removed node ids).
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
  private readonly endpoints = new Map<string, Endpoint>();
  private readonly ready: Promise<void>;
  private cursor: string;
  private heartbeatTimer?: NodeJS.Timeout;
  private sweepTimer?: NodeJS.Timeout;
  private loop?: Promise<void>;
  private heartbeating?: Promise<void>;
  private sweeping = false;
  private recoveryPending = false;
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
    this.leaseDuration = opts.leaseDuration ?? 30_000;
    for (const name of [
      'leaseDuration',
      'heartbeatInterval',
      'sweepInterval',
      'blockTimeout',
      'inboxMaxLength',
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

    const factory = (opts.backend ??
      createRedisRelayBackend) as RelayBackendFactory<C>;
    this.backend = factory({
      connection: opts.connection,
      namespace: this.namespace,
      prefix: opts.prefix,
      inboxMaxLength: opts.inboxMaxLength,
      skipVersionCheck: opts.skipVersionCheck,
    });
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
    const endpoint: Endpoint = { pattern, listener, lastMid: 0 };
    // Registered first, so live messages are dispatched as soon as the
    // subscription exists.
    this.endpoints.set(endpointId, endpoint);
    try {
      const { retained } = await this.backend.subscribe(
        this.nodeId,
        endpointId,
        pattern,
      );
      // A live message newer than the retained one may already have arrived.
      if (retained && Number(retained.mid) > endpoint.lastMid) {
        this.deliver(endpoint, {
          topic: pattern,
          mid: retained.mid,
          ts: retained.ts,
          data: retained.data,
          retained: true,
        });
      }
    } catch (err) {
      this.endpoints.delete(endpointId);
      throw err;
    }
    return {
      pattern,
      unsubscribe: async () => {
        if (this.endpoints.delete(endpointId) && !this.closing) {
          await this.backend.removeEndpoint(this.nodeId, endpointId);
        }
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
    const serialized = JSON.stringify(data === undefined ? null : data);
    return this.backend.publish(topic, serialized, {
      ts: Date.now(),
      retainMs: opts.retain ?? 0,
      maxSize: this.maxMessageSize,
    });
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
    await this.backend.waitUntilReady();
    await this.backend.registerNode(this.nodeId, this.leaseDuration);
    if (this.closing) {
      return;
    }

    const heartbeatInterval =
      this.opts.heartbeatInterval ??
      Math.max(1, Math.floor(this.leaseDuration / 3));
    this.heartbeatTimer = setInterval(
      () => this.heartbeat().catch(err => this.emitError(err)),
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
    try {
      await this.ready;
    } catch {
      // closing anyway
    }
    this.endpoints.clear();
    this.backend.interruptInbox();
    await this.loop?.catch((): void => undefined);
    await this.heartbeating?.catch((): void => undefined);
    try {
      await this.backend.unregisterNode(this.nodeId);
    } catch (err) {
      this.emitError(err);
    }
    await this.backend.close();
  }

  private heartbeat(): Promise<void> {
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
    })().finally(() => {
      this.heartbeating = undefined;
    });
    return this.heartbeating;
  }

  /**
   * The node's lease expired or it was swept: register again and restore
   * its subscriptions. Retained messages are not delivered again. If it fails
   * part way, the next heartbeat retries it.
   */
  private async recover(): Promise<void> {
    this.recoveryPending = true;
    await this.backend.registerNode(this.nodeId, this.leaseDuration);
    for (const [endpointId, endpoint] of this.endpoints) {
      await this.backend.subscribe(this.nodeId, endpointId, endpoint.pattern);
      if (!this.endpoints.has(endpointId)) {
        await this.backend.removeEndpoint(this.nodeId, endpointId);
      }
    }
    this.recoveryPending = false;
    this.emit('recovered');
  }

  private async sweep(): Promise<void> {
    if (this.closing || this.sweeping) {
      return;
    }
    this.sweeping = true;
    try {
      const removed = await this.backend.sweep(100);
      if (removed.length > 0) {
        this.emit('swept', removed);
      }
    } finally {
      this.sweeping = false;
    }
  }

  private async readLoop(): Promise<void> {
    while (!this.closing) {
      try {
        const batch = await this.backend.readInbox(this.nodeId, this.cursor, {
          blockMs: this.blockTimeout,
          count: 100,
        });
        if (batch.entries.length > 0 && !this.closing) {
          // A lease may have expired while reading. Recover before listeners
          // consume messages, so they can invalidate state after a routing gap.
          await this.heartbeat();
        }
        if (this.closing) {
          break;
        }
        this.cursor = batch.cursor;
        for (const entry of batch.entries) {
          this.dispatch(entry);
        }
      } catch (err) {
        if (this.closing) {
          break;
        }
        this.emitError(err);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  private dispatch(entry: RelayInboxEntry): void {
    for (const endpointId of entry.endpoints) {
      const endpoint = this.endpoints.get(endpointId);
      if (endpoint) {
        this.deliver(endpoint, {
          topic: entry.topic,
          mid: entry.mid,
          ts: entry.ts,
          data: entry.data,
          retained: false,
        });
      }
    }
  }

  private deliver(endpoint: Endpoint, message: RelayMessage<string>): void {
    endpoint.lastMid = Math.max(endpoint.lastMid, Number(message.mid));
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
