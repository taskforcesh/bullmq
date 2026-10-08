import { ConnectionOptions } from './redis-options';

/**
 * A message as stored in a node's inbox. `endpoints` lists the endpoints of
 * the reading node that the message is for: routing is resolved by the
 * datastore, so the runtime never matches topics itself.
 */
export interface RelayInboxEntry {
  kind: 'msg';
  topic: string;
  /** Message id, unique and increasing per namespace. */
  mid: string;
  /** Publish timestamp (ms), as given by the publisher. */
  ts: number;
  /** Payload, serialized by the publisher. */
  data: string;
  endpoints: string[];
}

export interface RelayInboxBatch {
  entries: RelayInboxEntry[];
  /**
   * Opaque position to pass to the next {@link IRelayBackend.readInbox} call.
   * Entries are only considered consumed once the next call is made with it.
   */
  cursor: string;
}

export interface RelayRetainedMessage {
  mid: string;
  ts: number;
  data: string;
}

export interface RelaySubscribeResult {
  /** False when the endpoint was already subscribed to the pattern. */
  added: boolean;
  /**
   * The retained message of an exact topic, read atomically with the
   * subscription. Never set for patterns with wildcards.
   */
  retained?: RelayRetainedMessage;
}

export interface RelayPublishOptions {
  /** Publish timestamp (ms). */
  ts: number;
  /** Keep the message as the topic's retained value for this long (0: no). */
  retainMs: number;
  /** Max size of the serialized payload, in bytes. */
  maxSize: number;
}

export interface RelayPublishResult {
  mid: string;
  /** Live nodes the message was delivered to. */
  nodes: number;
  /** Endpoints the message was delivered to. */
  endpoints: number;
}

/**
 * IRelayBackend
 *
 * Datastore-agnostic contract used by the {@link Relay}. Every operation is
 * implemented as a single atomic Lua script (Redis) or SQL function
 * (PostgreSQL), so the routing logic is shared verbatim by every BullMQ
 * runtime. Implementations only translate arguments and results.
 *
 * Errors are thrown as {@link RelayError} with one of the shared codes.
 *
 * @experimental The contract may change in minor releases while the relay
 * is completed.
 */
export interface IRelayBackend {
  readonly namespace: string;

  /** Position from which a freshly registered node reads its inbox. */
  readonly initialInboxCursor: string;

  waitUntilReady(): Promise<void>;

  /** Closes the backend's connections it owns. */
  close(): Promise<void>;

  /** Registers (or refreshes) a node and its liveness lease. */
  registerNode(nodeId: string, leaseMs: number): Promise<void>;

  /**
   * Renews a node's lease.
   *
   * @returns false when the node is not registered any more (its lease expired
   * and it was swept). The caller must register again and restore its
   * subscriptions.
   */
  heartbeat(nodeId: string, leaseMs: number): Promise<boolean>;

  /** Removes a node with its subscriptions and inbox. */
  unregisterNode(nodeId: string): Promise<boolean>;

  /**
   * Removes up to `limit` nodes whose lease expired, with their subscriptions
   * and inboxes.
   *
   * @returns the ids of the removed nodes.
   */
  sweep(limit: number): Promise<string[]>;

  subscribe(
    nodeId: string,
    endpointId: string,
    pattern: string,
  ): Promise<RelaySubscribeResult>;

  /** @returns the number of subscriptions removed. */
  removeEndpoint(nodeId: string, endpointId: string): Promise<number>;

  publish(
    topic: string,
    data: string,
    opts: RelayPublishOptions,
  ): Promise<RelayPublishResult>;

  /**
   * Returns the next entries of a node's inbox, waiting up to `blockMs` when
   * there are none (`0`: return immediately).
   */
  readInbox(
    nodeId: string,
    cursor: string,
    opts: { blockMs: number; count: number },
  ): Promise<RelayInboxBatch>;

  /** Makes a blocked {@link readInbox} return promptly (e.g. on close). */
  interruptInbox(): void;
}

export interface RelayBackendOptions<C = ConnectionOptions> {
  connection: C;
  namespace: string;
  /** Key prefix (Redis only). */
  prefix?: string;
  /** Approximate max inbox length per node (Redis only). */
  inboxMaxLength?: number;
  skipVersionCheck?: boolean;
}

export type RelayBackendFactory<C = ConnectionOptions> = (
  opts: RelayBackendOptions<C>,
) => IRelayBackend;
