import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { IRedisClient, IRedisTransaction } from '../interfaces/redis-client';

/**
 * Adapter that wraps Bun's built-in `RedisClient` so that it conforms to
 * {@link IRedisClient}.
 *
 * Bun's Redis client has a fundamentally different API from ioredis/node-redis:
 *   - No EventEmitter: uses `onconnect`/`onclose` callbacks instead
 *   - `close()` instead of `quit()`/`disconnect()` – doesn't throw errors
 *     into pending promises (they resolve to undefined or reject cleanly)
 *   - `send(command, args)` for raw commands (EVALSHA, SCAN, XREAD, etc.)
 *   - `duplicate()` is async (returns a Promise<RedisClient>)
 *   - MULTI/EXEC only via raw `send()` commands
 *   - Hash commands use arrays: hmset(key, [k,v,...]), hmget(key, [fields])
 *
 * Usage:
 * ```ts
 * import { RedisClient } from 'bun';
 * import { createBunRedisClient } from 'bullmq';
 *
 * const raw = new RedisClient('redis://localhost:6379');
 * const client = createBunRedisClient(raw);
 * await client.connect();
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

function normalizeStringCollection(reply: any): string[] {
  if (reply == null) {
    return [];
  }
  if (Array.isArray(reply)) {
    return reply.map(String);
  }
  if (reply instanceof Set) {
    return Array.from(reply, item => String(item));
  }
  return [];
}

export type RedisCommandArgument = string | Buffer;

export interface BunRedisRawClient {
  connected: boolean;
  url?: string;
  onconnect?: () => void;
  onclose?: (error?: Error) => void;
  onerror?: (error?: Error) => void;

  connect(): Promise<void>;
  close(): void;
  send<T = any>(command: string, args: RedisCommandArgument[]): Promise<T>;
  get(key: string): Promise<string | null | undefined>;
  smembers(key: string): Promise<unknown[] | null | undefined>;
  incr(key: string): Promise<number>;
}

type BunRedisClientConstructor<TClient extends BunRedisRawClient> = new (
  url?: string,
) => TClient;

export function createBunRedisClient<TClient extends BunRedisRawClient>(
  client: TClient,
  opts?: { lazyConnect?: boolean },
): IRedisClient {
  return new BunRedisAdapter(client, opts);
}

/**
 * Full wrapper for Bun's RedisClient.
 *
 * Key design decisions vs node-redis adapter:
 * 1. No error noise on close: Bun's close() cleanly terminates pending
 *    commands without throwing DisconnectsClientError.
 * 2. EventEmitter bridging: Bun uses `onconnect`/`onclose` callbacks;
 *    we bridge those into standard EventEmitter events.
 * 3. Raw command execution: Bun's `send()` is the universal escape hatch
 *    for commands without convenience methods.
 */
class BunRedisAdapter<TClient extends BunRedisRawClient>
  extends EventEmitter
  implements IRedisClient
{
  private scripts = new Map<string, LuaScript>();
  private _statusOverride: string | undefined;
  private _hasConnected = false;
  private _closed = false;
  private _closing = false;
  private _connecting?: Promise<void>;
  // Serialize raw send() calls per connection to avoid Bun delivering
  // concurrent command responses to the wrong pending promise.
  private _sendQueue: Promise<void> = Promise.resolve();
  // Auto-reconnect state
  private _reconnecting = false;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _reconnectAttempts = 0;
  private _maxReconnectDelay = 20000; // cap at 20s (matches ioredis default)

  get status(): string {
    if (this._statusOverride) {
      return this._statusOverride;
    }
    if (this._closed) {
      return 'end';
    }
    if (this.raw.connected) {
      return 'ready';
    }
    return this._hasConnected ? 'end' : 'wait';
  }
  set status(val: string) {
    if (val === 'end') {
      this._closing = true;
      this._closed = true;
      // Do not call raw.close() here – disconnect()/quit() handle closing.
    }
    this._statusOverride = val;
  }

  readonly isCluster = false;

  get options(): Record<string, any> {
    return {};
  }
  set options(_val: Record<string, any>) {
    // no-op
  }

  constructor(
    private raw: TClient,
    opts?: { lazyConnect?: boolean },
  ) {
    super();

    this._setupCallbacks();

    // ioredis auto-connects by default. Mimic that behavior unless
    // lazyConnect is set.
    if (!opts?.lazyConnect) {
      this.connect().catch(() => {
        // Connection errors will be emitted via the 'error' event.
      });
    }
  }

  /**
   * Wire up Bun's callback-style events into EventEmitter and auto-reconnect.
   */
  private _setupCallbacks(): void {
    // Bridge Bun's callback-style events into EventEmitter
    this.raw.onconnect = () => {
      this._hasConnected = true;
      this._closed = false;
      this._closing = false;
      this._reconnecting = false;
      this._reconnectAttempts = 0;
      this._statusOverride = undefined;
      this.emit('ready');
    };
    this.raw.onclose = (error?: Error) => {
      if (this._closing) {
        // User-initiated close – no reconnect
        this._closed = true;
        this.emit('close');
        this.emit('end');
        return;
      }

      // Unexpected close – attempt auto-reconnect
      this._closed = true;
      this.emit('close');

      if (error) {
        this.emit('error', error);
      }

      this._scheduleReconnect();
    };
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  private _scheduleReconnect(): void {
    if (this._closing || this._reconnecting) {
      return;
    }
    this._reconnecting = true;
    this._reconnectAttempts++;

    // Exponential backoff: min(e^attempts, 20000) ms, floored at 1000ms
    const delay = Math.max(
      Math.min(
        Math.exp(this._reconnectAttempts) * 100,
        this._maxReconnectDelay,
      ),
      1000,
    );

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;

      if (this._closing) {
        this._reconnecting = false;
        return;
      }

      try {
        // Create a fresh raw client with the same URL
        const BunRedisClient = this.raw
          .constructor as BunRedisClientConstructor<TClient>;
        const newRaw = new BunRedisClient(this.raw.url);

        // Swap the raw client reference
        this.raw = newRaw;
        this._closed = false;
        this._connecting = undefined;

        // Re-wire callbacks on the new raw client
        this._setupCallbacks();

        // Connect – onconnect callback will emit 'ready' and reset state
        await newRaw.connect();
      } catch (_err) {
        // Reconnect failed – schedule another attempt
        this._reconnecting = false;
        if (!this._closing) {
          this._scheduleReconnect();
        }
      }
    }, delay);
  }

  // ---------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------

  async connect(): Promise<void> {
    if (this.raw.connected) {
      this._hasConnected = true;
      this._closed = false;
      this._closing = false;
      this._statusOverride = undefined;
      return;
    }

    if (!this._connecting) {
      this._closed = false;
      this._closing = false;
      this._statusOverride = undefined;

      // If the raw client was previously closed, Bun doesn't support
      // reconnecting on the same instance. Create a fresh raw client.
      if (this._hasConnected && !this.raw.connected) {
        const BunRedisClient = this.raw
          .constructor as BunRedisClientConstructor<TClient>;
        this.raw = new BunRedisClient(this.raw.url);
        this._setupCallbacks();
      }

      this._connecting = this.raw
        .connect()
        .then(() => {
          this._hasConnected = true;
          this._closed = false;
          this._closing = false;
          this._statusOverride = undefined;
        })
        .finally(() => {
          this._connecting = undefined;
        });
    }

    await this._connecting;
  }

  private _closeRaw(): void {
    // Cancel any pending reconnect
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._reconnecting = false;

    const raw = this.raw;
    raw.onclose = () => {};
    raw.onerror = () => {};
    if (raw.connected) {
      // Defer close so that Bun's native error is raised outside the
      // calling test's synchronous scope, preventing it from being
      // attributed to the test as an unhandled error.
      setImmediate(() => {
        try {
          if (raw.connected) {
            raw.close();
          }
        } catch (_err) {
          // swallow
        }
      });
    }
  }

  disconnect(reconnect?: boolean): void {
    if (this._closed && !reconnect) {
      return;
    }

    if (reconnect) {
      // Close the current raw connection and schedule a reconnect.
      // Don't set _closing=true so the reconnect logic is allowed to fire.
      this._closed = true;
      this._statusOverride = undefined;

      const raw = this.raw;
      raw.onclose = () => {};
      if (raw.connected) {
        setImmediate(() => {
          try {
            if (raw.connected) {
              raw.close();
            }
          } catch (_err) {
            // swallow
          }
        });
      }

      this.emit('close');
      this._scheduleReconnect();
    } else {
      this._closing = true;
      this._closed = true;
      this._statusOverride = 'end';
      this._closeRaw();
      this.emit('close');
      this.emit('end');
    }
  }

  async quit(): Promise<string> {
    if (this._closed) {
      setImmediate(() => {
        this.emit('end');
        this.emit('close');
      });
      return 'OK';
    }
    this._closing = true;
    this._closed = true;
    this._statusOverride = 'end';
    this._closeRaw();
    // Emit on next tick so callers can register listeners after await quit()
    setImmediate(() => {
      this.emit('end');
      this.emit('close');
    });
    return 'OK';
  }

  duplicate(...args: any[]): IRedisClient {
    // Bun's duplicate() is async, but IRedisClient.duplicate() is sync.
    // We create a new RedisClient with the same URL/options instead.
    // The raw client constructor in Bun doesn't connect until connect() or
    // first command, so this is safe.
    const BunRedisClient = this.raw
      .constructor as BunRedisClientConstructor<TClient>;
    const dup = new BunRedisClient(this.raw.url);
    const adapter = new BunRedisAdapter(dup);

    // Copy registered scripts to the duplicate
    for (const [name, script] of this.scripts) {
      adapter.scripts.set(name, script);
      (adapter as any)[name] = (...a: any[]) => adapter.runCommand(name, a);
    }

    // Handle connectionName option
    const opts = args[0];
    if (opts && typeof opts === 'object' && opts.connectionName) {
      const connName = opts.connectionName;
      const origConnect = adapter.connect.bind(adapter);
      adapter.connect = async () => {
        await origConnect();
        try {
          await adapter.clientSetName(connName);
        } catch {
          // Client may have been closed before setName completes
        }
      };
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
    (this as any)[name] = (...args: any[]) => this.runCommand(name, args);

    // Pre-load the script into Redis
    this.sendCommand('SCRIPT', ['LOAD', definition.lua]).catch(() => {
      // Ignore – runCommand has NOSCRIPT fallback
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
    const argv = commandArgs.slice(numberOfKeys).map((a: any) => {
      if (Buffer.isBuffer(a)) {
        return a;
      }
      if (a === undefined || a === null) {
        return '';
      }
      return String(a);
    });

    // Build EVALSHA args: sha numkeys key... arg...
    const evalArgs = [sha, String(keys.length), ...keys, ...argv];

    const execute = async () => {
      try {
        return await this.sendCommand('EVALSHA', evalArgs);
      } catch (err: any) {
        if (err?.message?.includes?.('NOSCRIPT')) {
          const evalLuaArgs = [lua, String(keys.length), ...keys, ...argv];
          return await this.sendCommand('EVAL', evalLuaArgs);
        }
        throw err;
      }
    };

    return execute();
  }

  async sendCommand<T = any>(
    command: string,
    args: RedisCommandArgument[],
  ): Promise<T> {
    const run = this._sendQueue.then(() => this.raw.send<T>(command, args));
    this._sendQueue = run.then(
      (): void => undefined,
      (): void => undefined,
    );
    return run;
  }

  async queueExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this._sendQueue.then(operation, operation);
    this._sendQueue = run.then(
      (): void => undefined,
      (): void => undefined,
    );
    return run;
  }

  // ---------------------------------------------------------------
  // Pipeline / Transaction
  // ---------------------------------------------------------------

  multi(): IRedisTransaction {
    return new BunRedisTransaction(this.raw, this.scripts, true, this);
  }

  pipeline(): IRedisTransaction {
    return new BunRedisTransaction(this.raw, this.scripts, false, this);
  }

  // ---------------------------------------------------------------
  // Hash commands
  // ---------------------------------------------------------------

  async hgetall(key: string): Promise<Record<string, string>> {
    const result = await this.sendCommand('HGETALL', [key]);
    if (!result || (Array.isArray(result) && result.length === 0)) {
      return {};
    }
    // RESP3 returns a map, RESP2 returns flat array [field, value, ...]
    if (Array.isArray(result)) {
      const obj: Record<string, string> = {};
      for (let i = 0; i < result.length; i += 2) {
        obj[String(result[i])] = String(result[i + 1]);
      }
      return obj;
    }
    // If it's already an object (RESP3 map)
    return result;
  }

  async hget(key: string, field: string): Promise<string | null> {
    const result = await this.sendCommand('HGET', [key, field]);
    return result ?? null;
  }

  async hmget(key: string, ...fields: string[]): Promise<(string | null)[]> {
    const result = await this.sendCommand('HMGET', [key, ...fields]);
    return (result || []).map((v: any) => v ?? null);
  }

  async hset(
    key: string,
    dataOrField: Record<string, string | number> | string,
    ...rest: any[]
  ): Promise<number> {
    let args: string[];
    if (typeof dataOrField === 'object') {
      args = [key];
      for (const [k, v] of Object.entries(dataOrField)) {
        args.push(k, String(v));
      }
    } else {
      args = [key, dataOrField, String(rest[0])];
      for (let i = 1; i < rest.length; i += 2) {
        args.push(String(rest[i]), String(rest[i + 1]));
      }
    }
    return await this.sendCommand('HSET', args);
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    return await this.sendCommand('HDEL', [key, ...fields]);
  }

  async hexists(key: string, field: string): Promise<number> {
    const result = await this.sendCommand('HEXISTS', [key, field]);
    // Bun returns boolean for some commands; normalize to 0/1
    return result === true || result === 1 ? 1 : 0;
  }

  // ---------------------------------------------------------------
  // String commands
  // ---------------------------------------------------------------

  async get(key: string): Promise<string | null> {
    const result = await this.sendCommand('GET', [key]);
    return result ?? null;
  }

  async set(
    key: string,
    value: string | number,
    options?: { PX?: number; EX?: number },
  ): Promise<string | null> {
    const args = [key, String(value)];
    if (options?.PX != null) {
      args.push('PX', String(options.PX));
    } else if (options?.EX != null) {
      args.push('EX', String(options.EX));
    }
    return await this.sendCommand('SET', args);
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }
    return await this.sendCommand('DEL', keys);
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
    const args = [key, String(start), String(end)];
    if (options?.WITHSCORES) {
      args.push('WITHSCORES');
    }
    const result = await this.sendCommand('ZRANGE', args);
    if (!result) {
      return [];
    }
    // Bun returns WITHSCORES as [[member, score], ...] instead of flat [member, score, ...]
    if (options?.WITHSCORES && result.length > 0 && Array.isArray(result[0])) {
      return result.flatMap((pair: any) => [String(pair[0]), String(pair[1])]);
    }
    return result.map(String);
  }

  async zrevrange(
    key: string,
    start: number,
    end: number,
    options?: { WITHSCORES?: boolean },
  ): Promise<string[]> {
    const args = [key, String(start), String(end)];
    if (options?.WITHSCORES) {
      args.push('WITHSCORES');
    }
    // ZREVRANGE is deprecated; use ZRANGE REV
    args.push('REV');
    const result = await this.sendCommand('ZRANGE', args);
    if (!result) {
      return [];
    }
    // Bun returns WITHSCORES as [[member, score], ...] instead of flat [member, score, ...]
    if (options?.WITHSCORES && result.length > 0 && Array.isArray(result[0])) {
      return result.flatMap((pair: any) => [String(pair[0]), String(pair[1])]);
    }
    return result.map(String);
  }

  async zcard(key: string): Promise<number> {
    return await this.sendCommand('ZCARD', [key]);
  }

  async zscore(key: string, member: string): Promise<string | null> {
    const score = await this.sendCommand('ZSCORE', [key, member]);
    return score != null ? String(score) : null;
  }

  // ---------------------------------------------------------------
  // List commands
  // ---------------------------------------------------------------

  async lrange(key: string, start: number, end: number): Promise<string[]> {
    const result = await this.sendCommand('LRANGE', [
      key,
      String(start),
      String(end),
    ]);
    return (result || []).map(String);
  }

  async llen(key: string): Promise<number> {
    return await this.sendCommand('LLEN', [key]);
  }

  async ltrim(key: string, start: number, end: number): Promise<string> {
    await this.sendCommand('LTRIM', [key, String(start), String(end)]);
    return 'OK';
  }

  async lpos(key: string, value: string): Promise<number | null> {
    const result = await this.sendCommand('LPOS', [key, value]);
    return result ?? null;
  }

  // ---------------------------------------------------------------
  // Set commands
  // ---------------------------------------------------------------

  async smembers(key: string): Promise<string[]> {
    const result = await this.sendCommand('SMEMBERS', [key]);
    return normalizeStringCollection(result);
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
    const args: string[] = [key];
    if (options?.MAXLEN != null) {
      args.push('MAXLEN');
      if (options.approximate !== false) {
        args.push('~');
      }
      args.push(String(options.MAXLEN));
    }
    args.push(id);
    for (const [k, v] of Object.entries(fields)) {
      args.push(k, String(v));
    }
    return await this.raw.send('XADD', args);
  }

  async xread(
    streams: { key: string; id: string }[],
    options?: { BLOCK?: number; COUNT?: number },
  ): Promise<any> {
    const args: string[] = [];
    if (options?.COUNT != null) {
      args.push('COUNT', String(options.COUNT));
    }
    if (options?.BLOCK != null) {
      args.push('BLOCK', String(options.BLOCK));
    }
    args.push('STREAMS');
    for (const s of streams) {
      args.push(s.key);
    }
    for (const s of streams) {
      args.push(s.id);
    }

    let result: any;
    try {
      result = await this.sendCommand('XREAD', args);
    } catch (err: any) {
      if (this._closing) {
        return null;
      }
      throw err;
    }
    if (!result) {
      return null;
    }

    // Normalize to ioredis format: [[streamName, [[id, [field, value, …]], …]], …]
    // Bun returns a map/object: { streamName: [[id, [field, value, ...]], ...], ... }
    if (Array.isArray(result)) {
      // RESP2 nested array format
      return result.map((stream: any) => {
        const streamName = String(stream[0]);
        const entries = (stream[1] || []).map((entry: any) => {
          const entryId = String(entry[0]);
          const fields = (entry[1] || []).map(String);
          return [entryId, fields];
        });
        return [streamName, entries];
      });
    }

    // Bun returns an object keyed by stream name
    return Object.entries(result).map(
      ([streamName, rawEntries]: [string, any]) => {
        const entries = (rawEntries || []).map((entry: any) => {
          const entryId = String(entry[0]);
          const fields = (entry[1] || []).map(String);
          return [entryId, fields];
        });
        return [streamName, entries];
      },
    );
  }

  async xtrim(
    key: string,
    strategy: 'MAXLEN',
    threshold: number,
    options?: { approximate?: boolean },
  ): Promise<number> {
    const args: string[] = [key, strategy];
    if (options?.approximate !== false) {
      args.push('~');
    }
    args.push(String(threshold));
    return await this.sendCommand('XTRIM', args);
  }

  // ---------------------------------------------------------------
  // Blocking commands
  // ---------------------------------------------------------------

  async bzpopmin(
    key: string,
    timeout: number,
  ): Promise<{ key: string; member: string; score: string } | null> {
    let result: any;
    try {
      result = await this.sendCommand('BZPOPMIN', [key, String(timeout)]);
    } catch (err: any) {
      if (this._closing) {
        return null;
      }
      throw err;
    }
    if (!result || result.length === 0) {
      return null;
    }
    return {
      key: String(result[0]),
      member: String(result[1]),
      score: String(result[2]),
    };
  }

  // ---------------------------------------------------------------
  // Server / admin commands
  // ---------------------------------------------------------------

  async info(): Promise<string> {
    return await this.sendCommand('INFO', []);
  }

  async clientSetName(name: string): Promise<any> {
    return await this.sendCommand('CLIENT', ['SETNAME', name]);
  }

  async clientList(): Promise<string> {
    return await this.sendCommand('CLIENT', ['LIST']);
  }

  // ---------------------------------------------------------------
  // Key scanning
  // ---------------------------------------------------------------

  async scan(
    cursor: string | number,
    options: { MATCH?: string; COUNT?: number },
  ): Promise<[string, string[]]> {
    const args: string[] = [String(cursor)];
    if (options?.MATCH) {
      args.push('MATCH', options.MATCH);
    }
    if (options?.COUNT) {
      args.push('COUNT', String(options.COUNT));
    }
    const result = await this.sendCommand('SCAN', args);
    // SCAN returns [cursor, [key, key, ...]]
    const keys = result[1];
    return [String(result[0]), Array.isArray(keys) ? keys.map(String) : []];
  }

  scanStream(options: { match: string; count?: number }): Readable {
    const adapter = this;
    let cursor = '0';
    let started = false;

    const readable = new Readable({
      objectMode: true,
      async read() {
        if (started && cursor === '0') {
          readable.push(null); // EOF
          return;
        }
        started = true;
        try {
          // Loop until we have keys to push or reach end of scan
          while (true) {
            const [nextCursor, keys] = await adapter.scan(cursor, {
              MATCH: options.match,
              COUNT: options.count,
            });
            cursor = nextCursor;
            if (keys.length > 0) {
              readable.push(keys);
              if (cursor === '0') {
                readable.push(null); // EOF
              }
              return;
            }
            if (cursor === '0') {
              readable.push(null); // EOF
              return;
            }
            // No keys but scan not complete — continue scanning
          }
        } catch (err) {
          readable.destroy(err as Error);
        }
      },
    });
    return readable;
  }

  // ---------------------------------------------------------------
  // Extra Redis commands used by BullMQ internals
  // ---------------------------------------------------------------

  async keys(pattern: string): Promise<string[]> {
    const result = await this.sendCommand('KEYS', [pattern]);
    return (result || []).map(String);
  }

  async exists(...keys: string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }
    const result = await this.sendCommand('EXISTS', keys);
    // Bun may return boolean for single key
    if (typeof result === 'boolean') {
      return result ? 1 : 0;
    }
    return result;
  }

  async zadd(key: string, ...args: any[]): Promise<number> {
    // ioredis format: zadd(key, score, member, score, member, ...)
    const cmdArgs = [key];
    for (let i = 0; i < args.length; i += 2) {
      cmdArgs.push(String(args[i]), String(args[i + 1]));
    }
    return await this.sendCommand('ZADD', cmdArgs);
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    return await this.sendCommand('ZREM', [key, ...members]);
  }

  async xlen(key: string): Promise<number> {
    return await this.sendCommand('XLEN', [key]);
  }

  async xrevrange(
    key: string,
    end: string,
    start: string,
    ...rest: any[]
  ): Promise<any> {
    const args: string[] = [key, end, start];
    if (rest[0] === 'COUNT') {
      args.push('COUNT', String(rest[1]));
    }
    const result = await this.sendCommand('XREVRANGE', args);
    if (!result) {
      return [];
    }
    // Normalize to ioredis format: [[id, [field, value, …]], …]
    return result.map((msg: any) => [
      String(msg[0]),
      (msg[1] || []).map(String),
    ]);
  }

  async sadd(key: string, ...members: (string | number)[]): Promise<number> {
    return await this.sendCommand('SADD', [key, ...members.map(String)]);
  }

  async scard(key: string): Promise<number> {
    return await this.sendCommand('SCARD', [key]);
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    return await this.sendCommand('LPUSH', [key, ...values]);
  }

  async rpop(key: string): Promise<string | null> {
    const result = await this.sendCommand('RPOP', [key]);
    return result ?? null;
  }

  async incr(key: string): Promise<number> {
    return await this.sendCommand('INCR', [key]);
  }

  async incrby(key: string, increment: number): Promise<number> {
    return await this.sendCommand('INCRBY', [key, String(increment)]);
  }

  async flushall(): Promise<string> {
    return await this.sendCommand('FLUSHALL', []);
  }
}

// ---------------------------------------------------------------------------
// Transaction / Pipeline wrapper
//
// Bun doesn't have a native MULTI object. We buffer commands and execute
// them within a MULTI/EXEC block using send().
// ---------------------------------------------------------------------------

class BunRedisTransaction implements IRedisTransaction {
  private commands: { cmd: string; args: (string | Buffer)[] }[] = [];
  private transformers: ((val: any) => any)[] = [];

  constructor(
    private readonly raw: any,
    private readonly scripts: Map<string, LuaScript>,
    private readonly transactional: boolean,
    private readonly adapter: BunRedisAdapter<any>,
  ) {}

  private addCommand(
    cmd: string,
    args: (string | Buffer)[],
    transformer?: (v: any) => any,
  ): void {
    this.commands.push({ cmd, args });
    this.transformers.push(transformer || ((v: any) => v));
  }

  hgetall(key: string): this {
    this.addCommand('HGETALL', [key], (val: any) => {
      if (!val || (Array.isArray(val) && val.length === 0)) {
        return {};
      }
      if (Array.isArray(val)) {
        const obj: Record<string, string> = {};
        for (let i = 0; i < val.length; i += 2) {
          obj[String(val[i])] = String(val[i + 1]);
        }
        return obj;
      }
      return val;
    });
    return this;
  }

  hset(key: string, data: Record<string, string | number>): this {
    const args = [key];
    for (const [k, v] of Object.entries(data)) {
      args.push(k, String(v));
    }
    this.addCommand('HSET', args);
    return this;
  }

  hscan(
    key: string,
    cursor: string | number,
    options?: { COUNT?: number },
  ): this {
    const args: string[] = [key, String(cursor)];
    if (options?.COUNT != null) {
      args.push('COUNT', String(options.COUNT));
    }
    this.addCommand('HSCAN', args, (val: any) => {
      // Normalize to ioredis format: [cursor, [field, value, field, value, ...]]
      if (!val) {
        return ['0', []];
      }
      if (Array.isArray(val)) {
        return [String(val[0]), normalizeStringCollection(val[1])];
      }
      return ['0', []];
    });
    return this;
  }

  smembers(key: string): this {
    this.addCommand('SMEMBERS', [key], (val: any) =>
      normalizeStringCollection(val),
    );
    return this;
  }

  sscan(
    key: string,
    cursor: string | number,
    options?: { COUNT?: number },
  ): this {
    const args: string[] = [key, String(cursor)];
    if (options?.COUNT != null) {
      args.push('COUNT', String(options.COUNT));
    }
    this.addCommand('SSCAN', args, (val: any) => {
      // Normalize to ioredis format: [cursor, [member, member, ...]]
      if (!val) {
        return ['0', []];
      }
      if (Array.isArray(val)) {
        return [String(val[0]), normalizeStringCollection(val[1])];
      }
      return ['0', []];
    });
    return this;
  }

  zrange(key: string, start: number, end: number): this {
    this.addCommand('ZRANGE', [key, String(start), String(end)], (val: any) =>
      Array.isArray(val) ? val.map(String) : [],
    );
    return this;
  }

  lrange(key: string, start: number, end: number): this {
    this.addCommand('LRANGE', [key, String(start), String(end)], (val: any) =>
      Array.isArray(val) ? val.map(String) : [],
    );
    return this;
  }

  llen(key: string): this {
    this.addCommand('LLEN', [key]);
    return this;
  }

  del(...keys: string[]): this {
    if (keys.length > 0) {
      this.addCommand('DEL', keys);
    }
    return this;
  }

  runCommand(name: string, args: any[]): this {
    const script = this.scripts.get(name);
    if (!script) {
      throw new Error(`BullMQ: unknown command "${name}" in transaction`);
    }
    const commandArgs = normalizeScriptArgs(args);
    const { sha, numberOfKeys } = script;
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
    this.addCommand('EVALSHA', [
      sha,
      String(cmdKeys.length),
      ...cmdKeys,
      ...argv,
    ]);
    return this;
  }

  async exec(): Promise<[Error | null, any][] | null> {
    if (this.commands.length === 0) {
      return [];
    }

    if (!this.transactional) {
      // Fire all commands concurrently for implicit pipelining (like ioredis).
      // This ensures all commands are written to the socket together, preventing
      // other operations from interleaving between pipeline commands.
      const settled = await Promise.allSettled(
        this.commands.map(({ cmd, args }) =>
          this.adapter.sendCommand(cmd, args),
        ),
      );
      return settled.map((result, i) => {
        if (result.status === 'rejected') {
          return [result.reason, null] as [Error, null];
        }
        const transformer = this.transformers[i];
        const value = transformer ? transformer(result.value) : result.value;
        return [null, value] as [null, any];
      });
    }

    // Execute as one exclusive queued operation so no command can be interleaved
    // between MULTI and EXEC on this connection.
    return this.adapter.queueExclusive(async () => {
      try {
        await this.raw.send('MULTI', []);

        // Queue all MULTI commands in the same turn without awaiting each send.
        // This avoids yielding between command enqueues before EXEC is issued.
        const queuedCommandPromises = this.commands.map(({ cmd, args }) =>
          this.raw.send(cmd, args),
        );

        // Issue EXEC immediately after enqueuing queued commands.
        const results = await this.raw.send('EXEC', []);

        // Prevent unhandled rejections from queued command promises.
        await Promise.allSettled(queuedCommandPromises);

        if (!results) {
          return null;
        }

        // Normalize to ioredis format: [Error | null, value][]
        return results.map((result: any, i: number) => {
          if (result instanceof Error) {
            return [result, null];
          }
          const transformer = this.transformers[i];
          const value = transformer ? transformer(result) : result;
          return [null, value];
        });
      } catch (err) {
        // Try to discard the MULTI state on error
        try {
          await this.raw.send('DISCARD', []);
        } catch {
          // ignore
        }
        throw err;
      }
    });
  }
}
