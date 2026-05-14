import { Readable } from 'stream';

/**
 * Redis client interface for BullMQ.
 *
 * Abstracts the underlying Redis client library (ioredis, node-redis, Bun
 * built-in Redis, etc.) while keeping Redis semantics.  Only the Redis
 * commands that BullMQ actually uses are declared here.
 *
 * Method signatures use **structured options objects** instead of ioredis-style
 * varargs so that every adapter (ioredis, node-redis, Bun, …) can map the
 * call to its native API without parsing positional string tokens.
 *
 * The reference implementation for ioredis lives in
 * `src/classes/ioredis-client.ts`.
 */
export interface IRedisClient {
  /**
   * Current connection status.
   * Adapters must expose at least the values `'ready'`, `'wait'`, and
   * `'end'` so that {@link RedisConnection.waitUntilReady} works correctly.
   */
  status: string;

  /** Whether this client is connected to a Redis Cluster. */
  readonly isCluster: boolean;

  /** Client configuration options (shape is adapter-specific). */
  options: Record<string, any>;

  // ============================================================
  // Connection lifecycle
  // ============================================================

  connect(): Promise<void>;
  disconnect(reconnect?: boolean): void;
  quit(): Promise<string>;

  /** Create a duplicate connection with optional overrides. */
  duplicate(...args: any[]): IRedisClient;

  // ============================================================
  // Event emitter (subset required by BullMQ)
  // ============================================================

  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  removeListener(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
  emit(event: string | symbol, ...args: any[]): boolean;
  setMaxListeners(n: number): this;
  getMaxListeners(): number;
  removeAllListeners(event?: string | symbol): this;

  // ============================================================
  // Lua script engine
  // ============================================================

  /** Register a Lua script as a named command. */
  defineCommand(
    name: string,
    definition: { numberOfKeys: number; lua: string },
  ): void;

  /** Execute a previously registered Lua script command by name. */
  runCommand(name: string, args: any[]): Promise<any>;

  // ============================================================
  // Pipeline / Transaction
  // ============================================================

  multi(): IRedisTransaction;
  pipeline(): IRedisTransaction;

  // ============================================================
  // Hash commands
  // ============================================================

  hgetall(key: string): Promise<Record<string, string>>;
  hget(key: string, field: string): Promise<string | null>;
  hmget(key: string, ...fields: string[]): Promise<(string | null)[]>;
  /** SET one or more hash fields from a field→value map. */
  hset(key: string, data: Record<string, string | number>): Promise<number>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  hexists(key: string, field: string): Promise<number>;

  // ============================================================
  // String commands
  // ============================================================

  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string | number,
    options?: { PX?: number; EX?: number },
  ): Promise<string | null>;
  del(...keys: string[]): Promise<number>;

  // ============================================================
  // Sorted set commands
  // ============================================================

  zrange(
    key: string,
    start: number,
    end: number,
    options?: { WITHSCORES?: boolean },
  ): Promise<string[]>;
  zrevrange(
    key: string,
    start: number,
    end: number,
    options?: { WITHSCORES?: boolean },
  ): Promise<string[]>;
  zcard(key: string): Promise<number>;
  zscore(key: string, member: string): Promise<string | null>;

  // ============================================================
  // List commands
  // ============================================================

  lrange(key: string, start: number, end: number): Promise<string[]>;
  llen(key: string): Promise<number>;
  ltrim(key: string, start: number, end: number): Promise<string>;
  lpos(key: string, value: string): Promise<number | null>;

  // ============================================================
  // Set commands
  // ============================================================

  smembers(key: string): Promise<string[]>;

  // ============================================================
  // Stream commands
  // ============================================================

  /**
   * Append an entry to a stream.
   *
   * @param key    - Stream key
   * @param id     - Entry ID (typically `'*'` for auto-generated)
   * @param fields - Field-value pairs for the stream entry
   * @param options - Optional MAXLEN trimming parameters
   */
  xadd(
    key: string,
    id: string,
    fields: Record<string, string | number>,
    options?: { MAXLEN?: number; approximate?: boolean },
  ): Promise<string>;

  /**
   * Read from one or more streams.
   *
   * @param streams - Array of stream/id pairs to read from
   * @param options - Optional BLOCK timeout and COUNT
   */
  xread(
    streams: { key: string; id: string }[],
    options?: { BLOCK?: number; COUNT?: number },
  ): Promise<any>;

  /**
   * Trim a stream.
   *
   * @param key       - Stream key
   * @param strategy  - Trim strategy (e.g. `'MAXLEN'`)
   * @param threshold - Maximum stream length
   * @param options   - Optional approximate trimming
   */
  xtrim(
    key: string,
    strategy: 'MAXLEN',
    threshold: number,
    options?: { approximate?: boolean },
  ): Promise<number>;

  // ============================================================
  // Blocking commands
  // ============================================================

  bzpopmin(
    key: string,
    timeout: number,
  ): Promise<{ key: string; member: string; score: string } | null>;

  // ============================================================
  // Server / admin commands
  // ============================================================

  info(): Promise<string>;
  clientSetName(name: string): Promise<any>;
  clientList(): Promise<string>;

  // ============================================================
  // Key scanning
  // ============================================================

  scan(
    cursor: string | number,
    options: { MATCH?: string; COUNT?: number },
  ): Promise<[string, string[]]>;
  scanStream(options: { match: string; count?: number }): Readable;

  // ============================================================
  // Cluster
  // ============================================================

  /** Return connections for each cluster node (only when isCluster). */
  nodes?(): IRedisClient[];
}

/**
 * Redis pipeline or transaction (MULTI).
 *
 * Commands are queued and executed together via {@link exec}.
 * Only the subset of commands BullMQ uses inside pipelines is declared.
 */
export interface IRedisTransaction {
  // Hash
  hgetall(key: string): this;
  hset(key: string, data: Record<string, string | number>): this;
  hscan(
    key: string,
    cursor: string | number,
    options?: { COUNT?: number },
  ): this;

  // Set
  smembers(key: string): this;
  sscan(
    key: string,
    cursor: string | number,
    options?: { COUNT?: number },
  ): this;

  // Sorted set
  zrange(key: string, start: number, end: number): this;

  // List
  lrange(key: string, start: number, end: number): this;
  llen(key: string): this;

  // Key
  del(...keys: string[]): this;

  // Lua script
  runCommand(name: string, args: any[]): this;

  /** Execute all queued commands. */
  exec(): Promise<[Error | null, any][] | null>;
}
