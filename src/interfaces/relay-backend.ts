import { ConnectionOptions } from './redis-options';

/**
 * A message as stored in a node's inbox. `endpoints` lists the endpoints of
 * the reading node that the message is for: routing is resolved by the
 * datastore, so the runtime never matches topics itself.
 */
export interface RelayInboxEntry {
  /**
   * Entry kind. Only `'msg'` exists today; readers must skip kinds they don't
   * know, so new kinds can be added without breaking older nodes.
   */
  kind: string;
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

/** Describes a node; stored as given and shown by dashboards. */
export interface RelayNodeInfo {
  /** A human-readable name, e.g. the service or connection name. */
  name?: string;
  host?: string;
  pid?: number;
  /** BullMQ version of the node. */
  version?: string;
}

export interface RelayNodeState {
  id: string;
  info: RelayNodeInfo;
  /** When the node registered (ms). */
  registeredAt: number;
  /**
   * When its lease ends (ms). A node whose lease ended is removed by the next
   * sweep; until then it's listed, without `lastHeartbeat`.
   */
  leaseUntil: number;
  lastHeartbeat?: number;
  /** Unread messages in its inbox, as of its last heartbeat. */
  backlog: number;
  /** Unread messages dropped because its inbox was full. */
  dropped: number;
  subscriptions: number;
}

export interface RelaySubscriptionState {
  nodeId: string;
  endpointId: string;
  pattern: string;
}

/** Restricts {@link IRelayBackend.getSubscriptions} to a node or a pattern. */
export type RelaySubscriptionFilter = { nodeId: string } | { pattern: string };

export interface RelayPatternState {
  pattern: string;
  subscriptions: number;
}

export interface RelayRetainedState extends RelayRetainedMessage {
  topic: string;
  expiresAt: number;
}

/**
 * A node's inbox connection (the long-lived connection on which it receives
 * its messages), as the datastore sees it.
 */
export interface RelayNodeConnection {
  /** Client address, as seen by the datastore ("ip:port", or "local"). */
  address: string;
  /** Seconds since the connection was opened. */
  age: number;
  /** Seconds since its last command (or state change, on PostgreSQL). */
  idle: number;
}

export interface RelayCounts {
  /** Registered nodes, including expired ones not swept yet. */
  nodes: number;
  subscriptions: number;
  /** Distinct patterns with at least one subscription. */
  patterns: number;
  retained: number;
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

  /** Registers (or refreshes) a node, its liveness lease and its info. */
  registerNode(
    nodeId: string,
    leaseMs: number,
    info?: RelayNodeInfo,
    inboxMaxLength?: number,
  ): Promise<void>;

  /**
   * Renews a node's lease.
   *
   * @returns false when the node is not registered or its lease expired,
   * even if it was not swept. The caller must register again and restore its
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
   * Deletes the retained message of a topic.
   *
   * @returns false if the topic had no retained message.
   */
  deleteRetained(topic: string): Promise<boolean>;

  /**
   * Returns the next entries of a node's inbox, waiting up to `blockMs` when
   * there are none (`0`: return immediately).
   */
  readInbox(
    nodeId: string,
    cursor: string,
    opts: { blockMs: number; count: number },
  ): Promise<RelayInboxBatch>;

  /**
   * Removes the entries of a node's inbox that were already consumed (up to
   * `cursor`, as returned by {@link readInbox}) and the oldest entries beyond
   * `maxLength`.
   *
   * @returns the number of entries left: the messages the node hasn't read
   * yet (its backlog).
   */
  trimInbox(nodeId: string, cursor: string, maxLength: number): Promise<number>;

  /**
   * Read-only getters, for dashboards. Lists are paginated like the queue
   * getters: `start` and `end` are inclusive positions (from 0), and an `end`
   * of -1 means "to the end". Orders are stable: nodes by registration,
   * subscriptions and patterns by value (bytewise), retained messages by
   * expiry.
   */
  getCounts(): Promise<RelayCounts>;

  getNodes(start: number, end: number): Promise<RelayNodeState[]>;

  /** All subscriptions, or those of a node or a pattern. */
  getSubscriptions(
    filter: RelaySubscriptionFilter | undefined,
    start: number,
    end: number,
  ): Promise<RelaySubscriptionState[]>;

  getPatterns(start: number, end: number): Promise<RelayPatternState[]>;

  getRetained(start: number, end: number): Promise<RelayRetainedState[]>;

  /**
   * Namespaces of the datastore (or Redis prefix) with live nodes or
   * retained messages, sorted by name.
   */
  getNamespaces(): Promise<string[]>;

  /**
   * The inbox connection of a node, as the datastore sees it (from
   * `CLIENT LIST` or `pg_stat_activity`): where it connects from, and for
   * how long.
   * Empty when the node isn't connected. Lists every client connection of
   * the datastore, so use it on demand rather than polling it.
   */
  getNodeConnections(nodeId: string): Promise<RelayNodeConnection[]>;

  /**
   * Makes a blocked {@link readInbox} return (or fail) promptly, and later
   * reads stop waiting. Used on close, so an interrupt that lands while a read
   * is still starting is not lost.
   */
  interruptInbox(): void;
}

export interface RelayBackendOptions<C = ConnectionOptions> {
  connection: C;
  namespace: string;
  /**
   * The node this backend serves, if any: its inbox connection is named
   * after it, so getNodeConnections can find it.
   */
  nodeId?: string;
  /** Key prefix (Redis only). */
  prefix?: string;
  /** Fallback max inbox length per node, applied on publish (Redis). */
  inboxMaxLength?: number;
  skipVersionCheck?: boolean;
}

export type RelayBackendFactory<C = ConnectionOptions> = (
  opts: RelayBackendOptions<C>,
) => IRelayBackend;
