import { Cluster, Redis, ChainableCommander } from 'ioredis';
import { IRedisClient, IRedisTransaction } from '../interfaces/redis-client';

/**
 * Augments an ioredis Redis / Cluster instance so that it conforms to
 * {@link IRedisClient}.
 *
 * Since ioredis already exposes every Redis command that BullMQ uses
 * (hgetall, zrange, xread, pipeline, multi, nodes, …), the adapter
 * only needs to:
 *
 *   - `runCommand`    – execute a previously defined Lua script by name
 *   - `duplicate`     – ensure the returned instance is also augmented
 *   - `pipeline/multi` – add `runCommand` to the returned ChainableCommander
 *   - translate structured option objects to ioredis varargs where needed
 *
 * **Side-effect warning:** This function mutates the provided instance
 * in-place for zero-overhead augmentation.  When a user passes their own
 * ioredis client to BullMQ, the overrides are written onto that shared
 * object.  All overrides are **backward-compatible**: they detect whether
 * they are called with the ioredis native varargs style or the IRedisClient
 * structured-options style and dispatch accordingly.  External code that
 * calls e.g. `client.hset(key, 'f1', 'v1')` will continue to work after
 * augmentation.
 */
export function createIORedisClient<TClient extends Redis | Cluster>(
  client: TClient,
): TClient & IRedisClient {
  const adapter = client as any;

  if (adapter.__bullmq_iredis) {
    return adapter as TClient & IRedisClient;
  }
  adapter.__bullmq_iredis = true;

  // Ensure isCluster is a boolean.  ioredis Cluster sets it to true;
  // plain Redis leaves it undefined.
  if (typeof adapter.isCluster !== 'boolean') {
    adapter.isCluster = false;
  }

  // Lua script engine
  adapter.runCommand = function (name: string, args: any[]): any {
    return adapter[name](args);
  };

  // Pipeline / Multi — add runCommand + structured overrides
  const origPipeline = client.pipeline.bind(client);
  adapter.pipeline = function (...args: any[]): IRedisTransaction {
    return augmentTransaction(origPipeline(...args));
  };

  const origMulti = client.multi.bind(client);
  adapter.multi = function (...args: any[]): IRedisTransaction {
    return augmentTransaction(origMulti(...args));
  };

  // Duplicate — ensure the result is also augmented.
  // ioredis Cluster.duplicate(startupNodes?, options?) expects connection
  // options under `redisOptions`, while Redis.duplicate(options?) takes them
  // at the top level.  We normalise the call so that callers can always pass
  // a simple `{ connectionName }` object regardless of the client type.
  if (typeof client.duplicate === 'function') {
    const origDuplicate = client.duplicate.bind(client);
    const clientIsCluster = !!(client as any).isCluster;

    adapter.duplicate = function (opts?: Record<string, any>): IRedisClient {
      if (clientIsCluster) {
        const existingRedisOpts = (client as any).options?.redisOptions || {};
        const mergedRedisOpts = opts
          ? { ...existingRedisOpts, ...opts }
          : existingRedisOpts;
        return createIORedisClient(
          origDuplicate(undefined, { redisOptions: mergedRedisOpts }),
        );
      }
      return createIORedisClient(origDuplicate(opts as any));
    };
  }

  // --- Structured → ioredis varargs translations ---

  // hset: structured { f1: v1 } → ioredis hset(key, f1, v1, …)
  // Backward-compatible: if second arg is a string, caller is using ioredis varargs.
  const origHset = (client as any).hset.bind(client);
  adapter.hset = function (
    key: string,
    dataOrField: Record<string, string | number> | string,
    ...rest: any[]
  ): Promise<number> {
    if (typeof dataOrField === 'string') {
      return origHset(key, dataOrField, ...rest);
    }
    const args: (string | number)[] = [key];
    for (const [f, v] of Object.entries(dataOrField)) {
      args.push(f, v);
    }
    return origHset(...args);
  };

  // set: structured { PX?: n } → ioredis set(key, value, 'PX', n)
  // Backward-compatible: if third arg is a string, caller is using ioredis varargs.
  const origSet = (client as any).set.bind(client);
  adapter.set = function (
    key: string,
    value: string | number,
    optionsOrModifier?: { PX?: number; EX?: number } | string,
    ...rest: any[]
  ): Promise<string | null> {
    if (typeof optionsOrModifier === 'string' || optionsOrModifier == null) {
      return origSet(
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
    return origSet(...args);
  };

  // zrange: structured { WITHSCORES? } → ioredis zrange(key, start, end, 'WITHSCORES')
  // Backward-compatible: if fourth arg is a string, caller is using ioredis varargs.
  const origZrange = (client as any).zrange.bind(client);
  adapter.zrange = function (
    key: string,
    start: number,
    end: number,
    optionsOrStr?: { WITHSCORES?: boolean } | string,
    ...rest: any[]
  ): Promise<string[]> {
    if (typeof optionsOrStr === 'string') {
      return origZrange(key, start, end, optionsOrStr, ...rest);
    }
    if (optionsOrStr?.WITHSCORES) {
      return origZrange(key, start, end, 'WITHSCORES');
    }
    return origZrange(key, start, end);
  };

  // zrevrange: structured { WITHSCORES? } → ioredis zrevrange(key, start, end, 'WITHSCORES')
  // Backward-compatible: if fourth arg is a string, caller is using ioredis varargs.
  const origZrevrange = (client as any).zrevrange.bind(client);
  adapter.zrevrange = function (
    key: string,
    start: number,
    end: number,
    optionsOrStr?: { WITHSCORES?: boolean } | string,
    ...rest: any[]
  ): Promise<string[]> {
    if (typeof optionsOrStr === 'string') {
      return origZrevrange(key, start, end, optionsOrStr, ...rest);
    }
    if (optionsOrStr?.WITHSCORES) {
      return origZrevrange(key, start, end, 'WITHSCORES');
    }
    return origZrevrange(key, start, end);
  };

  // xadd: structured (key, id, { field: value }, { MAXLEN? }) → ioredis varargs
  // Backward-compatible: if third arg is a string, caller is using ioredis varargs
  // (e.g. xadd(key, id, field1, val1, field2, val2)).
  const origXadd = (client as any).xadd.bind(client);
  adapter.xadd = function (
    key: string,
    idOrModifier: string,
    fieldsOrArg: Record<string, string | number> | string,
    ...rest: any[]
  ): Promise<string> {
    if (typeof fieldsOrArg === 'string') {
      return origXadd(key, idOrModifier, fieldsOrArg, ...rest);
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
    return origXadd(...args);
  };

  // xread: structured ([{ key, id }], { BLOCK?, COUNT? }) → ioredis varargs
  // Backward-compatible: if first arg is a string, caller is using ioredis varargs
  // (e.g. xread('BLOCK', 5000, 'STREAMS', key, id)).
  const origXread = (client as any).xread.bind(client);
  adapter.xread = function (
    streamsOrModifier: { key: string; id: string }[] | string,
    ...rest: any[]
  ): Promise<any> {
    if (typeof streamsOrModifier === 'string') {
      return origXread(streamsOrModifier, ...rest);
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
    return origXread(...args);
  };

  // xtrim: structured (key, 'MAXLEN', threshold, { approximate? })
  // ioredis native is the same positional shape, so this is already compatible.
  const origXtrim = (client as any).xtrim.bind(client);
  adapter.xtrim = function (
    key: string,
    strategy: 'MAXLEN',
    thresholdOrApprox: number | string,
    ...rest: any[]
  ): Promise<number> {
    // Varargs passthrough: xtrim(key, 'MAXLEN', '~', 1000) or xtrim(key, 'MAXLEN', 1000)
    if (typeof thresholdOrApprox === 'string' || rest.length === 0) {
      return origXtrim(key, strategy, thresholdOrApprox, ...rest);
    }
    const options = rest[0] as { approximate?: boolean } | undefined;
    const args: any[] = [key, strategy];
    if (options?.approximate !== false) {
      args.push('~');
    }
    args.push(thresholdOrApprox);
    return origXtrim(...args);
  };

  // bzpopmin
  //
  // We deliberately do NOT override ioredis' native `bzpopmin` here.
  // ioredis returns `[key, member, score]` (a tuple) and that is also the
  // shape required by IRedisClient. Overriding the method on a shared user
  // instance would change the observable return shape for any non-BullMQ
  // code that uses `bzpopmin` on the same client.

  // clientSetName / clientList
  adapter.clientSetName = function (name: string): Promise<any> {
    return (client as any).client('SETNAME', name);
  };
  adapter.clientList = function (): Promise<string> {
    return (client as any).client('LIST');
  };

  // scan(cursor, { MATCH?, COUNT? })
  // Must detect if called with varargs (ioredis internal, e.g. from scanStream)
  // vs. structured options (IRedisClient interface).
  const origScan = (client as any).scan.bind(client);
  adapter.scan = function (cursor: string | number, ...rest: any[]): any {
    // If called with varargs style (e.g. from scanStream internally),
    // pass through unchanged.
    if (
      rest.length === 0 ||
      typeof rest[0] === 'string' ||
      typeof rest[0] === 'function'
    ) {
      return origScan(cursor, ...rest);
    }
    // Structured options: { MATCH?, COUNT? }
    const options = rest[0] as { MATCH?: string; COUNT?: number };
    const args: any[] = [cursor];
    if (options?.MATCH != null) {
      args.push('MATCH', options.MATCH);
    }
    if (options?.COUNT != null) {
      args.push('COUNT', options.COUNT);
    }
    return origScan(...args);
  };

  return adapter as TClient & IRedisClient;
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

  // Fast path for in-place ioredis augmentation.
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
