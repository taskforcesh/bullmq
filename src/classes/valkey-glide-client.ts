import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { IRedisClient, IRedisTransaction } from '../interfaces/redis-client';

interface LuaScript {
  sha: string;
  lua: string;
  numberOfKeys: number;
}

type GlideArg = string | Buffer;

type GlideRecordEntry<T = unknown> = {
  key: string | Buffer;
  value: T;
};

interface ValkeyGlideRawClient {
  customCommand(args: GlideArg[]): Promise<any>;
  close(): void;
  constructor?: {
    createClient?: (
      options: Record<string, any>,
    ) => Promise<ValkeyGlideRawClient>;
    name?: string;
  };
  config?: Record<string, any>;
  options?: Record<string, any>;
}

function isBuffer(value: unknown): value is Buffer {
  return Buffer.isBuffer(value);
}

function toGlideArg(value: unknown): GlideArg {
  if (isBuffer(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

function toStringValue(value: unknown): string {
  if (isBuffer(value)) {
    return value.toString();
  }
  return String(value);
}

function isKeyValueArray(value: unknown): value is GlideRecordEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      item =>
        item && typeof item === 'object' && 'key' in item && 'value' in item,
    )
  );
}

function normalizeScriptArgs(args: any[]): any[] {
  return args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
}

function normalizeHashReply(reply: unknown): Record<string, string> {
  if (!reply) {
    return {};
  }

  if (isKeyValueArray(reply)) {
    return reply.reduce<Record<string, string>>((acc, item) => {
      acc[toStringValue(item.key)] = toStringValue(item.value);
      return acc;
    }, {});
  }

  if (reply instanceof Map) {
    const out: Record<string, string> = {};
    for (const [key, value] of reply.entries()) {
      out[toStringValue(key)] = toStringValue(value);
    }
    return out;
  }

  if (Array.isArray(reply)) {
    const out: Record<string, string> = {};
    for (let i = 0; i < reply.length; i += 2) {
      out[toStringValue(reply[i])] = toStringValue(reply[i + 1]);
    }
    return out;
  }

  if (typeof reply === 'object') {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      reply as Record<string, unknown>,
    )) {
      out[key] = toStringValue(value);
    }
    return out;
  }

  return {};
}

function flattenFieldPairs(fields: unknown): string[] {
  if (!fields) {
    return [];
  }

  if (Array.isArray(fields)) {
    if (isKeyValueArray(fields)) {
      return fields.flatMap(pair => [
        toStringValue(pair.key),
        toStringValue(pair.value),
      ]);
    }

    if (fields.every(item => Array.isArray(item) && item.length === 2)) {
      return (fields as unknown[]).flatMap(pair => {
        const [field, value] = pair as [unknown, unknown];
        return [toStringValue(field), toStringValue(value)];
      });
    }

    return fields.map(item => toStringValue(item));
  }

  if (typeof fields === 'object') {
    return Object.entries(fields as Record<string, unknown>).flatMap(
      ([field, value]) => [field, toStringValue(value)],
    );
  }

  return [];
}

function normalizeXReadReply(reply: unknown): any {
  if (!reply) {
    return null;
  }

  if (
    Array.isArray(reply) &&
    reply.every(
      stream =>
        Array.isArray(stream) &&
        stream.length === 2 &&
        typeof stream[0] !== 'undefined' &&
        Array.isArray(stream[1]),
    )
  ) {
    return reply;
  }

  if (!isKeyValueArray(reply)) {
    return reply;
  }

  return reply.map(streamEntry => {
    const streamName = toStringValue(streamEntry.key);
    const messages = isKeyValueArray(streamEntry.value)
      ? streamEntry.value.map(message => [
          toStringValue(message.key),
          flattenFieldPairs(message.value),
        ])
      : [];

    return [streamName, messages];
  });
}

function normalizeScanReply(reply: unknown): [string, string[]] {
  if (Array.isArray(reply) && reply.length >= 2) {
    const [cursor, keys] = reply;
    const normalizedKeys = Array.isArray(keys)
      ? keys.map(key => toStringValue(key))
      : [];
    return [toStringValue(cursor), normalizedKeys];
  }

  if (reply && typeof reply === 'object') {
    const result = reply as { cursor?: unknown; keys?: unknown };
    if (result.cursor !== undefined && Array.isArray(result.keys)) {
      return [
        toStringValue(result.cursor),
        result.keys.map(key => toStringValue(key)),
      ];
    }
  }

  return ['0', []];
}

export function createValkeyGlideClient(client: unknown): IRedisClient {
  return new ValkeyGlideAdapter(client as ValkeyGlideRawClient);
}

class ValkeyGlideAdapter extends EventEmitter implements IRedisClient {
  private scripts = new Map<string, LuaScript>();
  private raw?: ValkeyGlideRawClient;
  private readonly rawPromise?: Promise<ValkeyGlideRawClient>;
  private statusOverride: string | undefined;
  private connecting?: Promise<void>;
  private readyEmitted = false;
  private closed = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    rawOrPromise: ValkeyGlideRawClient | Promise<ValkeyGlideRawClient>,
    private readonly connectionName?: string,
  ) {
    super();

    if (rawOrPromise instanceof Promise) {
      this.rawPromise = rawOrPromise;
    } else {
      this.raw = rawOrPromise;
    }
  }

  get status(): string {
    if (this.statusOverride) {
      return this.statusOverride;
    }
    if (this.closed) {
      return 'end';
    }
    if (this.raw) {
      return 'ready';
    }
    return 'wait';
  }

  set status(value: string) {
    if (value === 'end') {
      this.disconnect();
    }
    this.statusOverride = value;
  }

  get isCluster(): boolean {
    const name = this.raw?.constructor?.name ?? '';
    return name.includes('Cluster');
  }

  get options(): Record<string, any> {
    return this.raw?.config ?? this.raw?.options ?? {};
  }

  set options(_value: Record<string, any>) {
    // no-op
  }

  private async ensureRaw(): Promise<ValkeyGlideRawClient> {
    if (this.raw) {
      return this.raw;
    }
    if (!this.rawPromise) {
      throw new Error('BullMQ: missing Valkey Glide client instance');
    }
    this.raw = await this.rawPromise;
    return this.raw;
  }

  private async runSerialized<T>(
    fn: (raw: ValkeyGlideRawClient) => Promise<T>,
  ): Promise<T> {
    const previous = this.queue;
    let release: () => void;

    this.queue = new Promise<void>(resolve => {
      release = resolve;
    });

    await previous;

    try {
      const raw = await this.ensureRaw();
      return await fn(raw);
    } finally {
      release!();
    }
  }

  private async runRawCommand(args: GlideArg[]): Promise<any> {
    return this.runSerialized(async raw => raw.customCommand(args));
  }

  private async applyConnectionNameIfNeeded(): Promise<void> {
    if (!this.connectionName) {
      return;
    }
    await this.runRawCommand(['CLIENT', 'SETNAME', this.connectionName]);
  }

  async connect(): Promise<void> {
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = (async () => {
      await this.ensureRaw();
      await this.applyConnectionNameIfNeeded();
      this.closed = false;
      this.statusOverride = undefined;
      if (!this.readyEmitted) {
        this.readyEmitted = true;
        this.emit('ready');
      }
    })().finally(() => {
      this.connecting = undefined;
    });

    return this.connecting;
  }

  disconnect(): void {
    this.closed = true;
    this.statusOverride = 'end';

    if (this.raw) {
      try {
        this.raw.close();
      } catch {
        // ignore
      }
    }

    this.emit('close');
    this.emit('end');
  }

  async quit(): Promise<string> {
    this.disconnect();
    return 'OK';
  }

  duplicate(...args: any[]): IRedisClient {
    const options = (args[0] ?? {}) as { connectionName?: string };

    const duplicated = (async () => {
      const raw = await this.ensureRaw();
      const createClient = raw.constructor?.createClient;
      const config = raw.config ?? raw.options;

      if (!createClient || !config) {
        throw new Error(
          'BullMQ: Valkey Glide duplicate() requires a client created via ' +
            'GlideClient.createClient()/GlideClusterClient.createClient().',
        );
      }

      return createClient(config);
    })();

    return new ValkeyGlideAdapter(duplicated, options.connectionName);
  }

  defineCommand(
    name: string,
    definition: { numberOfKeys: number; lua: string; readOnly?: boolean },
  ): void {
    const sha = createHash('sha1').update(definition.lua).digest('hex');
    this.scripts.set(name, {
      sha,
      lua: definition.lua,
      numberOfKeys: definition.numberOfKeys,
    });
  }

  async runCommand(name: string, args: any[]): Promise<any> {
    const script = this.scripts.get(name);
    if (!script) {
      throw new Error(`BullMQ: unknown command "${name}"`);
    }

    const normalizedArgs = normalizeScriptArgs(args);
    const keys = normalizedArgs.slice(0, script.numberOfKeys).map(toGlideArg);
    const argv = normalizedArgs.slice(script.numberOfKeys).map(toGlideArg);

    const evalShaArgs: GlideArg[] = [
      'EVALSHA',
      script.sha,
      String(script.numberOfKeys),
      ...keys,
      ...argv,
    ];

    try {
      return await this.runRawCommand(evalShaArgs);
    } catch (err: any) {
      if (
        typeof err?.message === 'string' &&
        err.message.includes('NOSCRIPT')
      ) {
        return this.runRawCommand([
          'EVAL',
          script.lua,
          String(script.numberOfKeys),
          ...keys,
          ...argv,
        ]);
      }
      throw err;
    }
  }

  multi(): IRedisTransaction {
    return new ValkeyGlideTransaction(this, this.scripts);
  }

  pipeline(): IRedisTransaction {
    return this.multi();
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return normalizeHashReply(await this.runRawCommand(['HGETALL', key]));
  }

  async hget(key: string, field: string): Promise<string | null> {
    const value = await this.runRawCommand(['HGET', key, field]);
    return value == null ? null : toStringValue(value);
  }

  async hmget(key: string, ...fields: string[]): Promise<(string | null)[]> {
    const value = await this.runRawCommand(['HMGET', key, ...fields]);
    return Array.isArray(value)
      ? value.map(item => (item == null ? null : toStringValue(item)))
      : [];
  }

  async hset(
    key: string,
    data: Record<string, string | number>,
  ): Promise<number> {
    const args: GlideArg[] = ['HSET', key];
    for (const [field, value] of Object.entries(data)) {
      args.push(field, toGlideArg(value));
    }
    return Number(await this.runRawCommand(args));
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    return Number(await this.runRawCommand(['HDEL', key, ...fields]));
  }

  async hexists(key: string, field: string): Promise<number> {
    const result = await this.runRawCommand(['HEXISTS', key, field]);
    if (typeof result === 'boolean') {
      return result ? 1 : 0;
    }
    return Number(result);
  }

  async get(key: string): Promise<string | null> {
    const value = await this.runRawCommand(['GET', key]);
    return value == null ? null : toStringValue(value);
  }

  async set(
    key: string,
    value: string | number,
    options?: { PX?: number; EX?: number },
  ): Promise<string | null> {
    const args: GlideArg[] = ['SET', key, toGlideArg(value)];
    if (options?.PX != null) {
      args.push('PX', String(options.PX));
    } else if (options?.EX != null) {
      args.push('EX', String(options.EX));
    }
    const result = await this.runRawCommand(args);
    return result == null ? null : toStringValue(result);
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }
    return Number(await this.runRawCommand(['DEL', ...keys]));
  }

  async zrange(
    key: string,
    start: number,
    end: number,
    options?: { WITHSCORES?: boolean },
  ): Promise<string[]> {
    const args: GlideArg[] = ['ZRANGE', key, String(start), String(end)];
    if (options?.WITHSCORES) {
      args.push('WITHSCORES');
    }
    const result = await this.runRawCommand(args);
    return Array.isArray(result) ? result.map(toStringValue) : [];
  }

  async zrevrange(
    key: string,
    start: number,
    end: number,
    options?: { WITHSCORES?: boolean },
  ): Promise<string[]> {
    const args: GlideArg[] = ['ZREVRANGE', key, String(start), String(end)];
    if (options?.WITHSCORES) {
      args.push('WITHSCORES');
    }
    const result = await this.runRawCommand(args);
    return Array.isArray(result) ? result.map(toStringValue) : [];
  }

  async zcard(key: string): Promise<number> {
    return Number(await this.runRawCommand(['ZCARD', key]));
  }

  async zscore(key: string, member: string): Promise<string | null> {
    const result = await this.runRawCommand(['ZSCORE', key, member]);
    return result == null ? null : toStringValue(result);
  }

  async lrange(key: string, start: number, end: number): Promise<string[]> {
    const result = await this.runRawCommand([
      'LRANGE',
      key,
      String(start),
      String(end),
    ]);
    return Array.isArray(result) ? result.map(toStringValue) : [];
  }

  async llen(key: string): Promise<number> {
    return Number(await this.runRawCommand(['LLEN', key]));
  }

  async ltrim(key: string, start: number, end: number): Promise<string> {
    const result = await this.runRawCommand([
      'LTRIM',
      key,
      String(start),
      String(end),
    ]);
    return result == null ? 'OK' : toStringValue(result);
  }

  async lpos(key: string, value: string): Promise<number | null> {
    const result = await this.runRawCommand(['LPOS', key, value]);
    return result == null ? null : Number(result);
  }

  async smembers(key: string): Promise<string[]> {
    const result = await this.runRawCommand(['SMEMBERS', key]);
    return Array.isArray(result) ? result.map(toStringValue) : [];
  }

  async xadd(
    key: string,
    id: string,
    fields: Record<string, string | number>,
    options?: { MAXLEN?: number; approximate?: boolean },
  ): Promise<string> {
    const args: GlideArg[] = ['XADD', key];

    if (options?.MAXLEN != null) {
      args.push('MAXLEN');
      if (options.approximate !== false) {
        args.push('~');
      }
      args.push(String(options.MAXLEN));
    }

    args.push(id);

    for (const [field, value] of Object.entries(fields)) {
      args.push(field, toGlideArg(value));
    }

    return toStringValue(await this.runRawCommand(args));
  }

  async xread(
    streams: { key: string; id: string }[],
    options?: { BLOCK?: number; COUNT?: number },
  ): Promise<any> {
    const args: GlideArg[] = ['XREAD'];

    if (options?.BLOCK != null) {
      args.push('BLOCK', String(options.BLOCK));
    }

    if (options?.COUNT != null) {
      args.push('COUNT', String(options.COUNT));
    }

    args.push('STREAMS');
    for (const stream of streams) {
      args.push(stream.key);
    }
    for (const stream of streams) {
      args.push(stream.id);
    }

    return normalizeXReadReply(await this.runRawCommand(args));
  }

  async xtrim(
    key: string,
    strategy: 'MAXLEN',
    threshold: number,
    options?: { approximate?: boolean },
  ): Promise<number> {
    const args: GlideArg[] = ['XTRIM', key, strategy];
    if (options?.approximate !== false) {
      args.push('~');
    }
    args.push(String(threshold));
    return Number(await this.runRawCommand(args));
  }

  async bzpopmin(
    key: string,
    timeout: number,
  ): Promise<[key: string, member: string, score: string] | null> {
    const result = await this.runRawCommand(['BZPOPMIN', key, String(timeout)]);
    if (!result) {
      return null;
    }

    if (Array.isArray(result) && result.length >= 3) {
      return [
        toStringValue(result[0]),
        toStringValue(result[1]),
        toStringValue(result[2]),
      ];
    }

    return null;
  }

  async info(): Promise<string> {
    return toStringValue(await this.runRawCommand(['INFO']));
  }

  async clientSetName(name: string): Promise<any> {
    return this.runRawCommand(['CLIENT', 'SETNAME', name]);
  }

  async clientList(): Promise<string> {
    return toStringValue(await this.runRawCommand(['CLIENT', 'LIST']));
  }

  async scan(
    cursor: string | number,
    options: { MATCH?: string; COUNT?: number },
  ): Promise<[string, string[]]> {
    const args: GlideArg[] = ['SCAN', String(cursor)];

    if (options?.MATCH) {
      args.push('MATCH', options.MATCH);
    }

    if (options?.COUNT != null) {
      args.push('COUNT', String(options.COUNT));
    }

    return normalizeScanReply(await this.runRawCommand(args));
  }

  scanStream(options: { match: string; count?: number }): Readable {
    let cursor = '0';
    let running = false;

    const stream = new Readable({
      objectMode: true,
      read: () => {
        if (running) {
          return;
        }

        running = true;

        (async () => {
          do {
            const [nextCursor, keys] = await this.scan(cursor, {
              MATCH: options.match,
              COUNT: options.count,
            });

            cursor = nextCursor;
            if (keys.length > 0 && !stream.push(keys)) {
              return;
            }
          } while (cursor !== '0');

          stream.push(null);
        })()
          .catch(err => stream.destroy(err as Error))
          .finally(() => {
            running = false;
          });
      },
    });

    return stream;
  }

  async execQueuedCommands(
    commands: { args: GlideArg[]; transform?: (value: unknown) => unknown }[],
  ): Promise<[Error | null, any][] | null> {
    return this.runSerialized(async raw => {
      await raw.customCommand(['MULTI']);

      try {
        for (const command of commands) {
          await raw.customCommand(command.args);
        }

        const execResult = await raw.customCommand(['EXEC']);

        if (!execResult) {
          return null;
        }

        const results = Array.isArray(execResult) ? execResult : [execResult];

        return results.map((value, index) => {
          if (value instanceof Error) {
            return [value, null] as [Error | null, any];
          }

          const transform = commands[index]?.transform;
          return [null, transform ? transform(value) : value] as [
            Error | null,
            any,
          ];
        });
      } catch (err) {
        try {
          await raw.customCommand(['DISCARD']);
        } catch {
          // ignore
        }
        throw err;
      }
    });
  }
}

class ValkeyGlideTransaction implements IRedisTransaction {
  private readonly commands: {
    args: GlideArg[];
    transform?: (value: unknown) => unknown;
  }[] = [];

  constructor(
    private readonly adapter: ValkeyGlideAdapter,
    private readonly scripts: Map<string, LuaScript>,
  ) {}

  private queueCommand(
    args: GlideArg[],
    transform?: (value: unknown) => unknown,
  ): this {
    this.commands.push({ args, transform });
    return this;
  }

  hgetall(key: string): this {
    return this.queueCommand(['HGETALL', key], normalizeHashReply);
  }

  hset(key: string, data: Record<string, string | number>): this {
    const args: GlideArg[] = ['HSET', key];
    for (const [field, value] of Object.entries(data)) {
      args.push(field, toGlideArg(value));
    }
    return this.queueCommand(args);
  }

  hscan(
    key: string,
    cursor: string | number,
    options?: { COUNT?: number },
  ): this {
    const args: GlideArg[] = ['HSCAN', key, String(cursor)];
    if (options?.COUNT != null) {
      args.push('COUNT', String(options.COUNT));
    }

    return this.queueCommand(args, value => {
      if (Array.isArray(value) && value.length >= 2) {
        return [toStringValue(value[0]), flattenFieldPairs(value[1])];
      }
      return ['0', []];
    });
  }

  smembers(key: string): this {
    return this.queueCommand(['SMEMBERS', key], value =>
      Array.isArray(value) ? value.map(item => toStringValue(item)) : [],
    );
  }

  sscan(
    key: string,
    cursor: string | number,
    options?: { COUNT?: number },
  ): this {
    const args: GlideArg[] = ['SSCAN', key, String(cursor)];
    if (options?.COUNT != null) {
      args.push('COUNT', String(options.COUNT));
    }

    return this.queueCommand(args, value => {
      if (Array.isArray(value) && value.length >= 2) {
        const members = Array.isArray(value[1])
          ? value[1].map(item => toStringValue(item))
          : [];
        return [toStringValue(value[0]), members];
      }
      return ['0', []];
    });
  }

  zrange(key: string, start: number, end: number): this {
    return this.queueCommand(['ZRANGE', key, String(start), String(end)]);
  }

  lrange(key: string, start: number, end: number): this {
    return this.queueCommand(['LRANGE', key, String(start), String(end)]);
  }

  llen(key: string): this {
    return this.queueCommand(['LLEN', key]);
  }

  del(...keys: string[]): this {
    if (keys.length > 0) {
      this.queueCommand(['DEL', ...keys]);
    }
    return this;
  }

  runCommand(name: string, args: any[]): this {
    const script = this.scripts.get(name);
    if (!script) {
      throw new Error(`BullMQ: unknown command "${name}" in transaction`);
    }

    const normalizedArgs = normalizeScriptArgs(args);
    const keys = normalizedArgs.slice(0, script.numberOfKeys).map(toGlideArg);
    const argv = normalizedArgs.slice(script.numberOfKeys).map(toGlideArg);

    return this.queueCommand([
      'EVALSHA',
      script.sha,
      String(script.numberOfKeys),
      ...keys,
      ...argv,
    ]);
  }

  exec(): Promise<[Error | null, any][] | null> {
    return this.adapter.execQueuedCommands(this.commands);
  }
}
