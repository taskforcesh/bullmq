import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { IRedisClient, IRedisTransaction } from '../interfaces/redis-client';
import { ConnectionClosedError } from './errors/connection-closed-error';

/**
 * Adapter that wraps a `node-redis` (i.e. `@redis/client`) RedisClient
 * so that it conforms to {@link IRedisClient}.
 *
 * **No dependency is added** – the caller is responsible for creating the
 * node-redis client and passing it in. The raw client is typed structurally so
 * BullMQ itself never imports `redis` / `@redis/client`.
 *
 * Usage:
 *
 * ```ts
 * import { createClient } from 'redis';           // user's dependency
 * import { createNodeRedisClient } from 'bullmq'; // from this file
 *
 * const raw = createClient({ url: 'redis://localhost:6379' });
 * await raw.connect();
 * const client = createNodeRedisClient(raw);
 * ```
 */
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface LuaScript {
  sha: string;
  lua: string;
  numberOfKeys: number;
}

function normalizeScriptArgs(args: any[]): any[] {
  return args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
}

function isConnectionClosedError(err: any): boolean {
  return (
    err?.message === 'Disconnects client' ||
    err?.message === 'The client is closed' ||
    err?.message === 'Connection is closed.'
  );
}

export type NodeRedisCommandArgument = string | Buffer;

export interface NodeRedisRawTransaction {
  hGetAll(key: string): this;
  hSet(key: string, data: Record<string, string | number>): this;
  hScan(key: string, cursor: string, options?: Record<string, unknown>): this;
  sMembers(key: string): this;
  sScan(key: string, cursor: string, options?: Record<string, unknown>): this;
  zRange(key: string, start: number, end: number): this;
  lRange(key: string, start: number, end: number): this;
  lLen(key: string): this;
  del(keys: string[]): this;
  evalSha(
    sha: string,
    options: { keys: string[]; arguments: NodeRedisCommandArgument[] },
  ): this;
  exec(): Promise<unknown[] | null>;
}

export interface NodeRedisRawClient {
  isReady: boolean;
  isOpen: boolean;
  options?: Record<string, any>;

  on(event: string, listener: (...args: any[]) => void): this;
  connect(): Promise<unknown>;
  close?(): Promise<void>;
  destroy(): void | Promise<void>;
  quit(): Promise<unknown>;
  duplicate(): NodeRedisRawClient;

  scriptLoad(lua: string): Promise<unknown>;
  evalSha(
    sha: string,
    options: { keys: string[]; arguments: NodeRedisCommandArgument[] },
  ): Promise<any>;
  eval(
    lua: string,
    options: { keys: string[]; arguments: NodeRedisCommandArgument[] },
  ): Promise<any>;

  multi(): NodeRedisRawTransaction;

  hGetAll(key: string): Promise<Record<string, string>>;
  hGet(key: string, field: string): Promise<string | null | undefined>;
  hmGet(key: string, fields: string[]): Promise<(string | null | undefined)[]>;
  hSet(key: string, data: Record<string, string | number>): Promise<number>;
  hDel(key: string, fields: string[]): Promise<number>;
  hExists(key: string, field: string): Promise<boolean>;

  get(key: string): Promise<string | null | undefined>;
  set(
    key: string,
    value: string,
    options?: Record<string, unknown>,
  ): Promise<string | null>;
  del(keys: string[]): Promise<number>;

  zRange(
    key: string,
    start: number,
    end: number,
    options?: Record<string, unknown>,
  ): Promise<string[]>;
  zRangeWithScores?(
    key: string,
    start: number,
    end: number,
    options?: Record<string, unknown>,
  ): Promise<{ value: string; score: number }[]>;
  zCard(key: string): Promise<number>;
  zScore(key: string, member: string): Promise<number | string | null>;
  zAdd(
    key: string,
    members: { score: number; value: string }[],
  ): Promise<number>;
  zRem(key: string, members: string[]): Promise<number>;

  lRange(key: string, start: number, end: number): Promise<string[]>;
  lLen(key: string): Promise<number>;
  lTrim(key: string, start: number, end: number): Promise<unknown>;
  lPos(key: string, value: string): Promise<number | null | undefined>;
  lPush(key: string, values: string[]): Promise<number>;
  rPop(key: string): Promise<string | null>;

  sMembers(key: string): Promise<string[]>;
  sAdd(key: string, members: string[]): Promise<number>;
  sCard(key: string): Promise<number>;

  xAdd(
    key: string,
    id: string,
    fields: Record<string, string>,
    options?: Record<string, unknown>,
  ): Promise<string>;
  xRead(
    streams: { key: string; id: string }[],
    options?: Record<string, unknown>,
  ): Promise<any>;
  xTrim(
    key: string,
    strategy: 'MAXLEN',
    threshold: number,
    options?: Record<string, unknown>,
  ): Promise<number>;
  xLen(key: string): Promise<number>;
  xRevRange(
    key: string,
    end: string,
    start: string,
    options?: Record<string, unknown>,
  ): Promise<any[]>;

  bzPopMin(
    key: string,
    timeout: number,
  ): Promise<{ key: string; value: string; score: number | string } | null>;

  info(): Promise<string>;
  clientSetName(name: string): Promise<unknown>;
  sendCommand(args: string[]): Promise<string>;

  scan(
    cursor: string,
    options?: Record<string, unknown>,
  ): Promise<{ cursor: number | string; keys: string[] }>;
  scanIterator(
    options?: Record<string, unknown>,
  ): AsyncIterable<string | string[]>;
  keys(pattern: string): Promise<string[]>;
  exists(keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  incrBy(key: string, increment: number): Promise<number>;
  flushAll(): Promise<string>;
}

export function createNodeRedisClient(
  client: NodeRedisRawClient | any,
): IRedisClient {
  return new NodeRedisAdapter(client as NodeRedisRawClient);
}

/**
 * Full wrapper (not augmentation) because node-redis's API is structurally
 * different from ioredis and cannot be patched in-place.
 */
class NodeRedisAdapter<TClient extends NodeRedisRawClient>
  extends EventEmitter
  implements IRedisClient
{
  private scripts = new Map<string, LuaScript>();
  private statusOverride: string | undefined;
  private hasConnected = false;
  private destroying = false;
  private connectPromise: Promise<void> | undefined;
  private connectionName: string | undefined;

  /**
   * Expose connection status using the vocabulary that
   * {@link RedisConnection.waitUntilReady} expects:
   *   'wait'  → not yet connected, call connect()
   *   'ready' → usable
   *   'end'   → permanently closed
   */
  get status(): string {
    if (this.statusOverride) {
      return this.statusOverride;
    }
    if (this.raw.isReady) {
      return 'ready';
    }
    if (this.raw.isOpen) {
      return 'connect';
    }
    // Distinguish "never connected" from "disconnected after use"
    return this.hasConnected ? 'end' : 'wait';
  }
  set status(val: string) {
    // Allow RedisConnection to forcibly set 'end'
    if (val === 'end') {
      this.destroying = true;
      if (this.raw.isOpen) {
        try {
          this.raw.quit().catch(() => {});
        } catch {
          // already closed
        }
      }
    }
    this.statusOverride = val;
  }

  readonly isCluster = false; // TODO: cluster support

  get options(): Record<string, any> {
    return (this.raw.options as Record<string, any>) ?? {};
  }
  set options(val: Record<string, any>) {
    // no-op – callers sometimes assign
  }

  constructor(private readonly raw: TClient) {
    super();

    // Track first connection so status can distinguish 'wait' vs 'end'.
    // When a connectionName is set (via duplicate()), delay the 'ready'
    // event until CLIENT SETNAME completes so that callers waiting for
    // 'ready' (e.g. RedisConnection.waitUntilReady) see the name already
    // applied.
    raw.on('ready', () => {
      this.hasConnected = true;
      if (this.connectionName) {
        this.raw.clientSetName(this.connectionName).then(
          () => this.emit('ready'),
          () => this.emit('ready'), // emit ready even if setName fails
        );
      } else {
        this.emit('ready');
      }
    });
    raw.on('error', (err: Error) => {
      // Suppress the expected DisconnectsClientError that node-redis emits
      // when destroy() is called intentionally (e.g. during close/disconnect).
      if (this.destroying && isConnectionClosedError(err)) {
        return;
      }
      this.emit('error', err);
    });
    raw.on('end', () => this.emit('close'));
    raw.on('reconnecting', () => this.emit('reconnecting'));

    // Auto-connect eagerly, like ioredis does in its constructor.
    // This ensures commands can be issued immediately without an
    // explicit connect() call. The promise is stored so that
    // connect() is idempotent and callers can still await it.
    if (!raw.isOpen) {
      this.connectPromise = raw.connect().then(
        () => {
          this.connectPromise = undefined;
        },
        (err: Error) => {
          this.connectPromise = undefined;
          // Don't throw — errors surface via the 'error' event.
        },
      );
    }
  }

  // ---------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------

  async connect(): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise;
    }
    if (!this.raw.isOpen) {
      this.connectPromise = this.raw.connect().then(
        () => {
          this.connectPromise = undefined;
        },
        (err: Error) => {
          this.connectPromise = undefined;
          throw err;
        },
      );
      return this.connectPromise;
    }
    if (!this.raw.isReady) {
      await new Promise<void>((resolve, reject) => {
        const onReady = () => {
          cleanup();
          resolve();
        };
        const onError = (err: Error) => {
          cleanup();
          reject(err);
        };
        const onEnd = () => {
          cleanup();
          reject(new Error('Connection ended before ready event'));
        };
        const cleanup = () => {
          this.off('ready', onReady);
          this.off('error', onError);
          this.off('end', onEnd);
        };
        this.once('ready', onReady);
        this.once('error', onError);
        this.once('end', onEnd);
      });
    }
  }

  disconnect(reconnect = false): void {
    this.destroying = true;
    if (!reconnect) {
      this.statusOverride = 'end';
    }
    try {
      if (this.raw.isOpen) {
        // Use destroy() for immediate teardown. This interrupts any pending
        // blocking commands (e.g. BZPOPMIN) without waiting for them to
        // complete. The resulting "Disconnects client" rejections are handled
        // by BullMQ's isNotConnectionError() checks.
        this.raw.destroy();
      }
    } catch {
      // Swallow errors from already-closed connections
    }
    this.emit('close');
    if (reconnect) {
      this.statusOverride = undefined;
      this.emit('reconnecting');
      this.connect()
        .catch(err => {
          if (!isConnectionClosedError(err)) {
            this.emit('error', err);
          }
        })
        .finally(() => {
          this.destroying = false;
        });
    } else {
      // Emit both 'close' and 'end' so that all listeners are unblocked.
      // RedisConnection.close() listens for 'close', RedisConnection.disconnect() listens for 'end'.
      this.emit('end');
    }
  }

  async quit(): Promise<string> {
    if (this.destroying || this.statusOverride === 'end') {
      setImmediate(() => {
        this.emit('end');
        this.emit('close');
      });
      return 'OK';
    }

    this.destroying = true;
    try {
      if (this.raw.isOpen) {
        try {
          await this.raw.quit();
        } catch {
          // Swallow errors from already-closing connections
        }
      }
    } catch {
      // Swallow errors from already-closing connections
    }
    this.statusOverride = 'end';
    // Emit on next tick so callers can register listeners after await quit()
    setImmediate(() => {
      this.emit('end');
      this.emit('close');
    });
    return 'OK';
  }

  duplicate(...args: any[]): IRedisClient {
    const dup = this.raw.duplicate();
    const adapter = new NodeRedisAdapter(dup);
    // Copy registered scripts to the duplicate
    for (const [name, script] of this.scripts) {
      adapter.scripts.set(name, script);
      (adapter as any)[name] = (...args: any[]) =>
        adapter.runCommand(name, args);
    }
    // Handle connectionName option (ioredis calls CLIENT SETNAME automatically).
    // Setting connectionName BEFORE auto-connect resolves ensures the
    // constructor's 'ready' handler applies CLIENT SETNAME before emitting
    // 'ready', so callers (like RedisConnection.waitUntilReady) see the name
    // already set when the connection is reported as ready.
    const opts = args[0];
    if (opts && typeof opts === 'object' && opts.connectionName) {
      adapter.connectionName = opts.connectionName;
    }
    return adapter;
  }

  // ---------------------------------------------------------------
  // Lua script engine
  // ---------------------------------------------------------------

  defineCommand(
    name: string,
    definition: { numberOfKeys: number; lua: string },
  ): void {
    const sha = createHash('sha1').update(definition.lua).digest('hex');
    this.scripts.set(name, {
      sha,
      lua: definition.lua,
      numberOfKeys: definition.numberOfKeys,
    });
    // Mimic ioredis behavior: add a callable property on the instance
    // so that `(client as any)[name]` is defined (used by ScriptLoader cache check)
    (this as any)[name] = (...args: any[]) => this.runCommand(name, args);

    // Pre-load the script into Redis so that EVALSHA in transactions works
    // immediately. This mirrors what ioredis does under the hood.
    this.raw.scriptLoad(definition.lua).catch(() => {
      // Ignore errors here – runCommand has NOSCRIPT fallback for non-tx path
    });
  }

  async runCommand(name: string, args: any[]): Promise<any> {
    const script = this.scripts.get(name);
    if (!script) {
      throw new Error(`BullMQ: unknown command "${name}"`);
    }

    const commandArgs = normalizeScriptArgs(args);
    const { sha, lua, numberOfKeys } = script;
    const keys = commandArgs.slice(0, numberOfKeys).map(String);
    // Preserve Buffer arguments (e.g. msgpack data) – only stringify non-Buffers.
    // Convert undefined/null to '' to match ioredis behavior (keeps arg positions).
    const argv = commandArgs.slice(numberOfKeys).map((a: any) => {
      if (Buffer.isBuffer(a)) {
        return a;
      }
      if (a === undefined || a === null) {
        return '';
      }
      return String(a);
    });

    try {
      return await this.raw.evalSha(sha, { keys, arguments: argv });
    } catch (err: any) {
      if (this.destroying && isConnectionClosedError(err)) {
        return null;
      }
      if (isConnectionClosedError(err)) {
        throw new ConnectionClosedError(err.message, err);
      }
      // NOSCRIPT – fall back to EVAL which also caches the script
      if (err?.message?.includes?.('NOSCRIPT')) {
        try {
          return await this.raw.eval(lua, { keys, arguments: argv });
        } catch (evalErr: any) {
          if (this.destroying && isConnectionClosedError(evalErr)) {
            return null;
          }
          if (isConnectionClosedError(evalErr)) {
            throw new ConnectionClosedError(evalErr.message, evalErr);
          }
          throw evalErr;
        }
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------
  // Pipeline / Transaction
  // ---------------------------------------------------------------

  multi(): IRedisTransaction {
    return new NodeRedisTransaction(this.raw.multi(), this.scripts);
  }

  pipeline(): IRedisTransaction {
    // node-redis doesn't have a separate pipeline concept;
    // use multi() which behaves similarly for batching.
    return this.multi();
  }

  // ---------------------------------------------------------------
  // Hash commands
  // ---------------------------------------------------------------

  async hgetall(key: string): Promise<Record<string, string>> {
    const result = await this.raw.hGetAll(key);
    return result ?? {};
  }

  async hget(key: string, field: string): Promise<string | null> {
    return (await this.raw.hGet(key, field)) ?? null;
  }

  async hmget(key: string, ...fields: string[]): Promise<(string | null)[]> {
    const result = await this.raw.hmGet(key, fields);
    return result.map((v: any) => v ?? null);
  }

  async hset(
    key: string,
    dataOrField: Record<string, string | number> | string,
    ...rest: any[]
  ): Promise<number> {
    if (typeof dataOrField === 'object') {
      // Record-based call: hset(key, { field: value, ... })
      return await this.raw.hSet(key, dataOrField);
    }
    // Varargs call (ioredis compat): hset(key, field, value, field, value, ...)
    const record: Record<string, string> = {};
    record[dataOrField] = String(rest[0]);
    for (let i = 1; i < rest.length; i += 2) {
      record[String(rest[i])] = String(rest[i + 1]);
    }
    return await this.raw.hSet(key, record);
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    return await this.raw.hDel(key, fields);
  }

  async hexists(key: string, field: string): Promise<number> {
    const exists = await this.raw.hExists(key, field);
    return exists ? 1 : 0;
  }

  // ---------------------------------------------------------------
  // String commands
  // ---------------------------------------------------------------

  async get(key: string): Promise<string | null> {
    return (await this.raw.get(key)) ?? null;
  }

  async set(
    key: string,
    value: string | number,
    options?: { PX?: number; EX?: number },
  ): Promise<string | null> {
    const opts: any = {};
    if (options?.PX != null) {
      opts.PX = options.PX;
    } else if (options?.EX != null) {
      opts.EX = options.EX;
    }
    return await this.raw.set(key, String(value), opts);
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }
    return await this.raw.del(keys);
  }

  // ---------------------------------------------------------------
  // Sorted set commands
  // ---------------------------------------------------------------

  async zrange(
    key: string,
    start: number,
    end: number,
    options?: { WITHSCORES?: boolean },
  ): Promise<string[]> {
    if (options?.WITHSCORES) {
      // node-redis v5 uses a separate method for WITHSCORES
      const items = await (this.raw as any).zRangeWithScores(key, start, end);
      // Flatten to [member, score, member, score, …] like ioredis
      const flat: string[] = [];
      for (const item of items) {
        flat.push(item.value, String(item.score));
      }
      return flat;
    }
    return await this.raw.zRange(key, start, end);
  }

  async zrevrange(
    key: string,
    start: number,
    end: number,
    options?: { WITHSCORES?: boolean },
  ): Promise<string[]> {
    if (options?.WITHSCORES) {
      const items = await (this.raw as any).zRangeWithScores(key, start, end, {
        REV: true,
      });
      const flat: string[] = [];
      for (const item of items) {
        flat.push(item.value, String(item.score));
      }
      return flat;
    }
    return await this.raw.zRange(key, start, end, { REV: true });
  }

  async zcard(key: string): Promise<number> {
    return await this.raw.zCard(key);
  }

  async zscore(key: string, member: string): Promise<string | null> {
    const score = await this.raw.zScore(key, member);
    return score != null ? String(score) : null;
  }

  // ---------------------------------------------------------------
  // List commands
  // ---------------------------------------------------------------

  async lrange(key: string, start: number, end: number): Promise<string[]> {
    return await this.raw.lRange(key, start, end);
  }

  async llen(key: string): Promise<number> {
    return await this.raw.lLen(key);
  }

  async ltrim(key: string, start: number, end: number): Promise<string> {
    await this.raw.lTrim(key, start, end);
    return 'OK';
  }

  async lpos(key: string, value: string): Promise<number | null> {
    return (await this.raw.lPos(key, value)) ?? null;
  }

  // ---------------------------------------------------------------
  // Set commands
  // ---------------------------------------------------------------

  async smembers(key: string): Promise<string[]> {
    return await this.raw.sMembers(key);
  }

  // ---------------------------------------------------------------
  // Stream commands
  // ---------------------------------------------------------------

  async xadd(
    key: string,
    id: string,
    fields: Record<string, string | number>,
    options?: { MAXLEN?: number; approximate?: boolean },
  ): Promise<string> {
    const opts: any = {};
    if (options?.MAXLEN != null) {
      opts.TRIM = {
        strategy: 'MAXLEN',
        threshold: options.MAXLEN,
        strategyModifier: options.approximate === false ? undefined : '~',
      };
    }
    // node-redis xAdd rejects numeric field values — stringify all values
    const strFields: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) {
      strFields[k] = String(v);
    }
    return await this.raw.xAdd(key, id, strFields, opts);
  }

  async xread(
    streams: { key: string; id: string }[],
    options?: { BLOCK?: number; COUNT?: number },
  ): Promise<any> {
    const opts: any = {};
    if (options?.BLOCK != null) {
      opts.BLOCK = options.BLOCK;
    }
    if (options?.COUNT != null) {
      opts.COUNT = options.COUNT;
    }

    const streamArgs = streams.map(s => ({ key: s.key, id: s.id }));
    let result: any;
    try {
      result = await this.raw.xRead(streamArgs, opts);
    } catch (err: any) {
      if (this.destroying && isConnectionClosedError(err)) {
        return null;
      }
      if (isConnectionClosedError(err)) {
        throw new ConnectionClosedError(err.message, err);
      }
      throw err;
    }

    if (!result) {
      return null;
    }

    // Normalize to ioredis format: [[streamName, [[id, [field, value, …]], …]], …]
    return result.map((stream: any) => [
      stream.name,
      stream.messages.map((msg: any) => [
        msg.id,
        Object.entries(msg.message).flat(),
      ]),
    ]);
  }

  async xtrim(
    key: string,
    strategy: 'MAXLEN',
    threshold: number,
    options?: { approximate?: boolean },
  ): Promise<number> {
    const strategyModifier = options?.approximate === false ? undefined : '~';
    return await this.raw.xTrim(key, strategy, threshold, {
      strategyModifier,
    });
  }

  // ---------------------------------------------------------------
  // Blocking commands
  // ---------------------------------------------------------------

  async bzpopmin(
    key: string,
    timeout: number,
  ): Promise<[key: string, member: string, score: string] | null> {
    let result: { key: string; value: string; score: number | string } | null;
    try {
      result = await this.raw.bzPopMin(key, timeout);
    } catch (err: any) {
      if (this.destroying && isConnectionClosedError(err)) {
        return null;
      }
      if (isConnectionClosedError(err)) {
        throw new ConnectionClosedError(err.message, err);
      }
      throw err;
    }
    if (!result) {
      return null;
    }
    return [result.key, result.value, String(result.score)];
  }

  // ---------------------------------------------------------------
  // Server / admin commands
  // ---------------------------------------------------------------

  async info(): Promise<string> {
    return await this.raw.info();
  }

  async clientSetName(name: string): Promise<any> {
    return await this.raw.clientSetName(name);
  }

  async clientList(): Promise<string> {
    return await this.raw.sendCommand(['CLIENT', 'LIST']);
  }

  // ---------------------------------------------------------------
  // Key scanning
  // ---------------------------------------------------------------

  async scan(
    cursor: string | number,
    options: { MATCH?: string; COUNT?: number },
  ): Promise<[string, string[]]> {
    const opts: any = {};
    if (options?.MATCH) {
      opts.MATCH = options.MATCH;
    }
    if (options?.COUNT) {
      opts.COUNT = options.COUNT;
    }

    const result = await this.raw.scan(String(cursor), opts);
    return [String(result.cursor), result.keys];
  }

  scanStream(options: { match: string; count?: number }): Readable {
    const raw = this.raw;
    const connectPromise = this.connectPromise;
    const scanOpts: any = {};
    if (options.match) {
      scanOpts.MATCH = options.match;
    }
    if (options.count) {
      scanOpts.COUNT = options.count;
    }

    const readable = new Readable({
      objectMode: true,
      async read() {
        try {
          if (connectPromise) {
            await connectPromise;
          }
          for await (const keys of raw.scanIterator(scanOpts)) {
            if (!readable.push(Array.isArray(keys) ? keys : [keys])) {
              return; // backpressure
            }
          }
          readable.push(null); // EOF
        } catch (err) {
          readable.destroy(err as Error);
        }
      },
    });
    return readable;
  }

  // ---------------------------------------------------------------
  // Extra Redis commands (not part of IRedisClient but used by tests
  // and occasionally by user code that accesses the raw client).
  // ---------------------------------------------------------------

  async keys(pattern: string): Promise<string[]> {
    return await this.raw.keys(pattern);
  }

  async exists(...keys: string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }
    return await this.raw.exists(keys);
  }

  async zadd(key: string, ...args: any[]): Promise<number> {
    // ioredis: zadd(key, score, member, score, member, ...)
    const members: { score: number; value: string }[] = [];
    for (let i = 0; i < args.length; i += 2) {
      members.push({ score: Number(args[i]), value: String(args[i + 1]) });
    }
    return await this.raw.zAdd(key, members);
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    return await this.raw.zRem(key, members);
  }

  async xlen(key: string): Promise<number> {
    return await this.raw.xLen(key);
  }

  async xrevrange(
    key: string,
    end: string,
    start: string,
    ...rest: any[]
  ): Promise<any> {
    const opts: any = {};
    // ioredis: xrevrange(key, end, start, 'COUNT', n)
    if (rest[0] === 'COUNT') {
      opts.COUNT = Number(rest[1]);
    }
    const result = await this.raw.xRevRange(key, end, start, opts);
    // Normalize to ioredis format: [[id, [field, value, …]], …]
    return result.map((msg: any) => [
      msg.id,
      Object.entries(msg.message).flat(),
    ]);
  }

  async sadd(key: string, ...members: (string | number)[]): Promise<number> {
    return await this.raw.sAdd(key, members.map(String));
  }

  async scard(key: string): Promise<number> {
    return await this.raw.sCard(key);
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    return await this.raw.lPush(key, values);
  }

  async rpop(key: string): Promise<string | null> {
    return await this.raw.rPop(key);
  }

  async incr(key: string): Promise<number> {
    return await this.raw.incr(key);
  }

  async incrby(key: string, increment: number): Promise<number> {
    return await this.raw.incrBy(key, increment);
  }

  async flushall(): Promise<string> {
    return await this.raw.flushAll();
  }
}

// ---------------------------------------------------------------------------
// Transaction / Pipeline wrapper
// ---------------------------------------------------------------------------

class NodeRedisTransaction implements IRedisTransaction {
  private transformers: ((val: any) => any)[] = [];

  constructor(
    private readonly raw: any,
    private readonly scripts: Map<string, LuaScript>,
  ) {}

  private addIdentityTransformer(): void {
    this.transformers.push((v: any) => v);
  }

  hgetall(key: string): this {
    this.raw.hGetAll(key);
    this.addIdentityTransformer();
    return this;
  }

  hset(key: string, data: Record<string, string | number>): this {
    this.raw.hSet(key, data);
    this.addIdentityTransformer();
    return this;
  }

  hscan(
    key: string,
    cursor: string | number,
    options?: { COUNT?: number },
  ): this {
    const opts: any = {};
    if (options?.COUNT != null) {
      opts.COUNT = options.COUNT;
    }
    this.raw.hScan(key, String(cursor), opts);
    // Transform node-redis { cursor, entries: [{field, value}] }
    // to ioredis [cursor, [field, value, field, value, ...]]
    this.transformers.push((val: any) => {
      if (!val) {
        return ['0', []];
      }
      const flat: string[] = [];
      for (const entry of val.entries || []) {
        flat.push(entry.field, entry.value);
      }
      return [String(val.cursor), flat];
    });
    return this;
  }

  smembers(key: string): this {
    this.raw.sMembers(key);
    this.addIdentityTransformer();
    return this;
  }

  sscan(
    key: string,
    cursor: string | number,
    options?: { COUNT?: number },
  ): this {
    const opts: any = {};
    if (options?.COUNT != null) {
      opts.COUNT = options.COUNT;
    }
    this.raw.sScan(key, String(cursor), opts);
    // Transform node-redis { cursor, members: [...] }
    // to ioredis [cursor, [member, member, ...]]
    this.transformers.push((val: any) => {
      if (!val) {
        return ['0', []];
      }
      return [String(val.cursor), val.members || []];
    });
    return this;
  }

  zrange(key: string, start: number, end: number): this {
    this.raw.zRange(key, start, end);
    this.addIdentityTransformer();
    return this;
  }

  lrange(key: string, start: number, end: number): this {
    this.raw.lRange(key, start, end);
    this.addIdentityTransformer();
    return this;
  }

  llen(key: string): this {
    this.raw.lLen(key);
    this.addIdentityTransformer();
    return this;
  }

  del(...keys: string[]): this {
    if (keys.length > 0) {
      this.raw.del(keys);
      this.addIdentityTransformer();
    }
    return this;
  }

  runCommand(name: string, args: any[]): this {
    const script = this.scripts.get(name);
    if (!script) {
      throw new Error(`BullMQ: unknown command "${name}" in transaction`);
    }
    const commandArgs = normalizeScriptArgs(args);
    const { sha, lua, numberOfKeys } = script;
    const cmdKeys = commandArgs.slice(0, numberOfKeys).map(String);
    const argv = commandArgs.slice(numberOfKeys).map((a: any) => {
      if (Buffer.isBuffer(a)) {
        return a;
      }
      if (a === undefined || a === null) {
        return '';
      }
      return String(a);
    });

    // Use evalSha in pipeline; NOSCRIPT handling happens at exec()-time
    // node-redis multi supports evalSha
    this.raw.evalSha(sha, { keys: cmdKeys, arguments: argv });
    this.addIdentityTransformer();
    return this;
  }

  async exec(): Promise<[Error | null, any][] | null> {
    const results = await this.raw.exec();
    if (!results) {
      return null;
    }

    // node-redis multi.exec() returns values directly (or throws on error).
    // Normalize to ioredis format: [Error | null, value][]
    // Apply per-command transformers for format differences (hscan, sscan).
    return results.map((result: any, i: number) => {
      if (result instanceof Error) {
        return [result, null];
      }
      const transformer = this.transformers[i];
      const value = transformer ? transformer(result) : result;
      return [null, value];
    });
  }
}
