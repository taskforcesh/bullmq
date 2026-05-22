import { Cluster, Redis, ChainableCommander } from 'ioredis';
import { IRedisClient, IRedisTransaction } from '../interfaces/redis-client';

/**
 * Per-raw-client cache so repeated calls to `createIORedisClient` with the
 * same underlying ioredis instance return the same proxy. This preserves
 * event-listener identity for the BullMQ-facing client.
 */
const proxyCache = new WeakMap<object, IRedisClient>();

/**
 * Wraps an ioredis `Redis` / `Cluster` instance with a `Proxy` so it conforms
 * to {@link IRedisClient}.
 *
 * For backwards compatibility BullMQ continues to accept a raw `IORedis`
 * instance through tehe `connection` option, even though internally it relies
 * on the `IRedisClient` adapter interface. The returned proxy:
 *
 *   - exposes `runCommand` (Lua script dispatch by name)
 *   - exposes structured-options variants of `hset`, `set`, `zrange`,
 *     `zrevrange`, `xadd`, `xread`, `xtrim`, `scan` (backward-compatible:
 *     they still accept native ioredis varargs if called that way)
 *   - returns augmented {@link IRedisTransaction}s from `pipeline()` / `multi()`
 *   - wraps the result of `duplicate()` in a new proxy
 *
 * The underlying ioredis instance is **not** mutated. Properties and methods
 * not in the override table are forwarded to the raw client via the proxy
 * traps, with `this === target` so EventEmitter / Commander internals work
 * normally.
 */
export function createIORedisClient<TClient extends Redis | Cluster>(
  client: TClient,
): TClient & IRedisClient {
  // If the caller already passed a proxy produced by this function, return
  // it as-is. Wrapping a proxy in a second proxy would defeat the WeakMap
  // cache (the inner raw client is no longer reachable from the outer
  // argument) and break listener-identity / equality checks for callers
  // that hold on to the original wrapper.
  if ((client as any).__bullmq_iredis === true) {
    return client as TClient & IRedisClient;
  }

  const cached = proxyCache.get(client);
  if (cached) {
    return cached as TClient & IRedisClient;
  }

  const isCluster = (client as any).isCluster === true;
  // Cache bound prototype methods so the returned function identity is
  // stable across accesses (important for `once`/`removeListener` patterns).
  const boundCache = new Map<PropertyKey, any>();

  // Override table — properties returned by the proxy without touching the
  // underlying ioredis instance. The arrow functions close over `client`
  // directly so ioredis internals always see the raw instance as `this`.
  const overrides: Record<string | symbol, any> = Object.create(null);

  overrides.__bullmq_iredis = true;
  overrides.isCluster = isCluster;

  // Lua script engine.
  overrides.runCommand = (name: string, args: any[]): any => {
    return (client as any)[name](args);
  };

  // Pipeline / Multi — wrap the ChainableCommander with structured overrides.
  overrides.pipeline = (...args: any[]): IRedisTransaction => {
    return augmentTransaction(client.pipeline(...args));
  };
  overrides.multi = (...args: any[]): IRedisTransaction => {
    return augmentTransaction((client as any).multi(...args));
  };

  // duplicate — wrap the new raw client with a fresh proxy.
  // ioredis Cluster.duplicate(startupNodes?, options?) expects connection
  // options under `redisOptions`, while Redis.duplicate(options?) takes them
  // at the top level. Normalise so callers can always pass `{ connectionName }`.
  if (typeof (client as any).duplicate === 'function') {
    overrides.duplicate = (opts?: Record<string, any>): IRedisClient => {
      if (isCluster) {
        const existingRedisOpts = (client as any).options?.redisOptions || {};
        const mergedRedisOpts = opts
          ? { ...existingRedisOpts, ...opts }
          : existingRedisOpts;
        return createIORedisClient(
          (client as any).duplicate(undefined, {
            redisOptions: mergedRedisOpts,
          }),
        );
      }
      return createIORedisClient((client as any).duplicate(opts as any));
    };
  }

  // --- Structured → ioredis varargs translations ---
  // Each override accepts both the IRedisClient structured-options form and
  // the native ioredis varargs form, dispatching by argument shape.

  // hset: structured { f1: v1 } → ioredis hset(key, f1, v1, …)
  overrides.hset = (
    key: string,
    dataOrField: Record<string, string | number> | string,
    ...rest: any[]
  ): Promise<number> => {
    if (typeof dataOrField === 'string') {
      return (client as any).hset(key, dataOrField, ...rest);
    }
    const args: (string | number)[] = [key];
    for (const [f, v] of Object.entries(dataOrField)) {
      args.push(f, v);
    }
    return (client as any).hset(...args);
  };

  // set: structured { PX?: n } → ioredis set(key, value, 'PX', n)
  overrides.set = (
    key: string,
    value: string | number,
    optionsOrModifier?: { PX?: number; EX?: number } | string,
    ...rest: any[]
  ): Promise<string | null> => {
    if (typeof optionsOrModifier === 'string' || optionsOrModifier == null) {
      return (client as any).set(
        key,
        value,
        ...(optionsOrModifier != null ? [optionsOrModifier, ...rest] : []),
      );
    }
    const args: any[] = [key, value];
    if (optionsOrModifier.PX != null) {
      args.push('PX', optionsOrModifier.PX);
    } else if (optionsOrModifier.EX != null) {
      args.push('EX', optionsOrModifier.EX);
    }
    return (client as any).set(...args);
  };

  // zrange: structured { WITHSCORES? } → ioredis zrange(key, start, end, 'WITHSCORES')
  overrides.zrange = (
    key: string,
    start: number,
    end: number,
    optionsOrStr?: { WITHSCORES?: boolean } | string,
    ...rest: any[]
  ): Promise<string[]> => {
    if (typeof optionsOrStr === 'string') {
      return (client as any).zrange(key, start, end, optionsOrStr, ...rest);
    }
    if (optionsOrStr?.WITHSCORES) {
      return (client as any).zrange(key, start, end, 'WITHSCORES');
    }
    return (client as any).zrange(key, start, end);
  };

  // zrevrange: structured { WITHSCORES? } → ioredis zrevrange(key, start, end, 'WITHSCORES')
  overrides.zrevrange = (
    key: string,
    start: number,
    end: number,
    optionsOrStr?: { WITHSCORES?: boolean } | string,
    ...rest: any[]
  ): Promise<string[]> => {
    if (typeof optionsOrStr === 'string') {
      return (client as any).zrevrange(key, start, end, optionsOrStr, ...rest);
    }
    if (optionsOrStr?.WITHSCORES) {
      return (client as any).zrevrange(key, start, end, 'WITHSCORES');
    }
    return (client as any).zrevrange(key, start, end);
  };

  // xadd: structured (key, id, { field: value }, { MAXLEN? }) → ioredis varargs
  overrides.xadd = (
    key: string,
    idOrModifier: string,
    fieldsOrArg: Record<string, string | number> | string,
    ...rest: any[]
  ): Promise<string> => {
    if (typeof fieldsOrArg === 'string') {
      return (client as any).xadd(key, idOrModifier, fieldsOrArg, ...rest);
    }
    const options = rest[0] as
      | { MAXLEN?: number; approximate?: boolean }
      | undefined;
    const args: any[] = [key];
    if (options?.MAXLEN != null) {
      args.push('MAXLEN');
      if (options.approximate !== false) {
        args.push('~');
      }
      args.push(options.MAXLEN);
    }
    args.push(idOrModifier);
    for (const [f, v] of Object.entries(fieldsOrArg)) {
      args.push(f, v);
    }
    return (client as any).xadd(...args);
  };

  // xread: structured ([{ key, id }], { BLOCK?, COUNT? }) → ioredis varargs
  overrides.xread = (
    streamsOrModifier: { key: string; id: string }[] | string,
    ...rest: any[]
  ): Promise<any> => {
    if (typeof streamsOrModifier === 'string') {
      return (client as any).xread(streamsOrModifier, ...rest);
    }
    const options = rest[0] as { BLOCK?: number; COUNT?: number } | undefined;
    const args: any[] = [];
    if (options?.BLOCK != null) {
      args.push('BLOCK', options.BLOCK);
    }
    if (options?.COUNT != null) {
      args.push('COUNT', options.COUNT);
    }
    args.push('STREAMS');
    for (const s of streamsOrModifier) {
      args.push(s.key);
    }
    for (const s of streamsOrModifier) {
      args.push(s.id);
    }
    return (client as any).xread(...args);
  };

  // xtrim: structured (key, 'MAXLEN', threshold, { approximate? })
  overrides.xtrim = (
    key: string,
    strategy: 'MAXLEN',
    thresholdOrApprox: number | string,
    ...rest: any[]
  ): Promise<number> => {
    if (typeof thresholdOrApprox === 'string' || rest.length === 0) {
      return (client as any).xtrim(key, strategy, thresholdOrApprox, ...rest);
    }
    const options = rest[0] as { approximate?: boolean } | undefined;
    const args: any[] = [key, strategy];
    if (options?.approximate !== false) {
      args.push('~');
    }
    args.push(thresholdOrApprox);
    return (client as any).xtrim(...args);
  };

  // bzpopmin is not overridden — ioredis already returns
  // `[key, member, score]`, which matches IRedisClient.

  // clientSetName / clientList helpers that forward to CLIENT subcommands.
  overrides.clientSetName = (name: string): Promise<any> =>
    (client as any).client('SETNAME', name);
  overrides.clientList = (): Promise<string> => (client as any).client('LIST');

  // scan(cursor, { MATCH?, COUNT? }) — accepts either structured options or
  // ioredis varargs (used internally by `scanStream`).
  overrides.scan = (cursor: string | number, ...rest: any[]): any => {
    if (
      rest.length === 0 ||
      typeof rest[0] === 'string' ||
      typeof rest[0] === 'function'
    ) {
      return (client as any).scan(cursor, ...rest);
    }
    const options = rest[0] as { MATCH?: string; COUNT?: number };
    const args: any[] = [cursor];
    if (options?.MATCH != null) {
      args.push('MATCH', options.MATCH);
    }
    if (options?.COUNT != null) {
      args.push('COUNT', options.COUNT);
    }
    return (client as any).scan(...args);
  };

  const proxy = new Proxy(client, {
    get(target, prop) {
      if (prop in overrides) {
        return overrides[prop as string];
      }
      // Read against the raw target so getters on the prototype (e.g.
      // ioredis' EventEmitter internals) see `this === target` rather than
      // the proxy. This avoids infinite recursion through the proxy traps.
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') {
        return value;
      }
      // Own properties (including ioredis commands installed via
      // `defineCommand` and test-time spies set via `obj.method = spy`)
      // are bound fresh on each access so reassignment is honoured.
      if (Object.prototype.hasOwnProperty.call(target, prop)) {
        return value.bind(target);
      }
      // Prototype methods (EventEmitter, Commander, ...) are cached so
      // identity is stable across accesses.
      const cachedBound = boundCache.get(prop);
      if (cachedBound !== undefined) {
        return cachedBound;
      }
      const bound = value.bind(target);
      boundCache.set(prop, bound);
      return bound;
    },
    set(target, prop, value) {
      // Two assignment paths:
      //   - Properties present in the override table are reassigned in the
      //     table itself, so subsequent `get` traps return the new value
      //     (used by sinon-style spies that stub `runCommand`, `pipeline`,
      //     etc. on the proxy).
      //   - All other properties are written through to the raw ioredis
      //     instance via `Reflect.set`, and any stale bound-method entry is
      //     invalidated so the next access rebinds the new function.
      if (prop in overrides) {
        overrides[prop as string] = value;
        return true;
      }
      boundCache.delete(prop);
      return Reflect.set(target, prop, value);
    },
    deleteProperty(target, prop) {
      if (prop in overrides) {
        return false;
      }
      boundCache.delete(prop);
      return Reflect.deleteProperty(target, prop);
    },
    has(target, prop) {
      return prop in overrides || Reflect.has(target, prop);
    },
  }) as TClient & IRedisClient;

  proxyCache.set(client, proxy);
  return proxy;
}

/**
 * Adds `runCommand` and structured overrides to an ioredis ChainableCommander
 * so it satisfies {@link IRedisTransaction}.
 */
function augmentTransaction(commander: ChainableCommander): IRedisTransaction {
  const transaction = commander as any;
  transaction.runCommand = function (name: string, args: any[]): any {
    transaction[name](args);
    return transaction;
  };

  // hset(key, { f1: v1 }) → ioredis pipeline.hset(key, f1, v1, …)
  const origHset = transaction.hset.bind(transaction);
  transaction.hset = function (
    key: string,
    data: Record<string, string | number>,
  ): any {
    const args: (string | number)[] = [key];
    for (const [f, v] of Object.entries(data)) {
      args.push(f, v);
    }
    origHset(...args);
    return transaction;
  };

  // hscan(key, cursor, { COUNT? }) → ioredis hscan(key, cursor, 'COUNT', n)
  const origHscan = transaction.hscan.bind(transaction);
  transaction.hscan = function (
    key: string,
    cursor: string | number,
    options?: { COUNT?: number },
  ): any {
    if (options?.COUNT != null) {
      origHscan(key, cursor, 'COUNT', options.COUNT);
    } else {
      origHscan(key, cursor);
    }
    return transaction;
  };

  // sscan(key, cursor, { COUNT? })
  const origSscan = transaction.sscan.bind(transaction);
  transaction.sscan = function (
    key: string,
    cursor: string | number,
    options?: { COUNT?: number },
  ): any {
    if (options?.COUNT != null) {
      origSscan(key, cursor, 'COUNT', options.COUNT);
    } else {
      origSscan(key, cursor);
    }
    return transaction;
  };

  return transaction as IRedisTransaction;
}

/**
 * Check if an object already implements {@link IRedisClient}.
 */
export function isIRedisClient(obj: any): obj is IRedisClient {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  // Fast path for ioredis instances already wrapped by `createIORedisClient`.
  if ((obj as any).__bullmq_iredis === true) {
    return true;
  }

  // Fallback structural check for wrapper-based adapters
  // (node-redis, Bun, or custom IRedisClient implementations).
  return (
    typeof obj.runCommand === 'function' &&
    typeof obj.defineCommand === 'function' &&
    typeof obj.pipeline === 'function' &&
    typeof obj.multi === 'function' &&
    typeof obj.duplicate === 'function' &&
    typeof obj.scanStream === 'function' &&
    typeof obj.connect === 'function' &&
    typeof obj.disconnect === 'function' &&
    typeof obj.on === 'function' &&
    typeof obj.status === 'string' &&
    typeof obj.isCluster === 'boolean'
  );
}
