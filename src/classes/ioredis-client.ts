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
 * Methods are added directly to the existing instance (zero-overhead
 * augmentation, no wrapper object).  If the instance has already been
 * augmented, it is returned as-is.
 */
export function createIORedisClient<TClient extends Redis | Cluster>(
  client: TClient,
): TClient & IRedisClient {
  const a = client as any;

  if (a.__bullmq_iredis) {
    return a as TClient & IRedisClient;
  }
  a.__bullmq_iredis = true;

  // Lua script engine
  a.runCommand = function (name: string, args: any[]): any {
    return a[name](args);
  };

  // Pipeline / Multi — add runCommand + structured overrides
  const origPipeline = client.pipeline.bind(client);
  a.pipeline = function (...args: any[]): IRedisTransaction {
    return augmentTransaction(origPipeline(...args));
  };

  const origMulti = client.multi.bind(client);
  a.multi = function (...args: any[]): IRedisTransaction {
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

    a.duplicate = function (opts?: Record<string, any>): IRedisClient {
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

  // hset(key, { f1: v1, f2: v2 }) → ioredis hset(key, f1, v1, f2, v2)
  const origHset = (client as any).hset.bind(client);
  a.hset = function (
    key: string,
    data: Record<string, string | number>,
  ): Promise<number> {
    const args: (string | number)[] = [key];
    for (const [f, v] of Object.entries(data)) {
      args.push(f, v);
    }
    return origHset(...args);
  };

  // set(key, value, { PX?: n }) → ioredis set(key, value, 'PX', n)
  const origSet = (client as any).set.bind(client);
  a.set = function (
    key: string,
    value: string | number,
    options?: { PX?: number; EX?: number },
  ): Promise<string | null> {
    const args: any[] = [key, value];
    if (options?.PX != null) {
      args.push('PX', options.PX);
    } else if (options?.EX != null) {
      args.push('EX', options.EX);
    }
    return origSet(...args);
  };

  // zrange(key, start, end, { WITHSCORES? }) → ioredis zrange(key, start, end [, 'WITHSCORES'])
  const origZrange = (client as any).zrange.bind(client);
  a.zrange = function (
    key: string,
    start: number,
    end: number,
    options?: { WITHSCORES?: boolean },
  ): Promise<string[]> {
    if (options?.WITHSCORES) {
      return origZrange(key, start, end, 'WITHSCORES');
    }
    return origZrange(key, start, end);
  };

  // zrevrange(key, start, end, { WITHSCORES? })
  const origZrevrange = (client as any).zrevrange.bind(client);
  a.zrevrange = function (
    key: string,
    start: number,
    end: number,
    options?: { WITHSCORES?: boolean },
  ): Promise<string[]> {
    if (options?.WITHSCORES) {
      return origZrevrange(key, start, end, 'WITHSCORES');
    }
    return origZrevrange(key, start, end);
  };

  // xadd(key, id, fields, { MAXLEN?, approximate? })
  const origXadd = (client as any).xadd.bind(client);
  a.xadd = function (
    key: string,
    id: string,
    fields: Record<string, string | number>,
    options?: { MAXLEN?: number; approximate?: boolean },
  ): Promise<string> {
    const args: any[] = [key];
    if (options?.MAXLEN != null) {
      args.push('MAXLEN');
      if (options.approximate !== false) {
        args.push('~');
      }
      args.push(options.MAXLEN);
    }
    args.push(id);
    for (const [f, v] of Object.entries(fields)) {
      args.push(f, v);
    }
    return origXadd(...args);
  };

  // xread([{ key, id }], { BLOCK?, COUNT? })
  const origXread = (client as any).xread.bind(client);
  a.xread = function (
    streams: { key: string; id: string }[],
    options?: { BLOCK?: number; COUNT?: number },
  ): Promise<any> {
    const args: any[] = [];
    if (options?.BLOCK != null) {
      args.push('BLOCK', options.BLOCK);
    }
    if (options?.COUNT != null) {
      args.push('COUNT', options.COUNT);
    }
    args.push('STREAMS');
    for (const s of streams) {
      args.push(s.key);
    }
    for (const s of streams) {
      args.push(s.id);
    }
    return origXread(...args);
  };

  // xtrim(key, strategy, threshold, { approximate? })
  const origXtrim = (client as any).xtrim.bind(client);
  a.xtrim = function (
    key: string,
    strategy: 'MAXLEN',
    threshold: number,
    options?: { approximate?: boolean },
  ): Promise<number> {
    const args: any[] = [key, strategy];
    if (options?.approximate !== false) {
      args.push('~');
    }
    args.push(threshold);
    return origXtrim(...args);
  };

  // bzpopmin → convert [key, member, score] array to object
  const origBzpopmin = (client as any).bzpopmin.bind(client);
  a.bzpopmin = function (
    key: string,
    timeout: number,
  ): Promise<{ key: string; member: string; score: string } | null> {
    return origBzpopmin(key, timeout).then(
      (result: [string, string, string] | null) => {
        if (!result) {
          return null;
        }
        return { key: result[0], member: result[1], score: result[2] };
      },
    );
  };

  // clientSetName / clientList
  a.clientSetName = function (name: string): Promise<any> {
    return (client as any).client('SETNAME', name);
  };
  a.clientList = function (): Promise<string> {
    return (client as any).client('LIST');
  };

  // scan(cursor, { MATCH?, COUNT? })
  // Must detect if called with varargs (ioredis internal, e.g. from scanStream)
  // vs. structured options (IRedisClient interface).
  const origScan = (client as any).scan.bind(client);
  a.scan = function (cursor: string | number, ...rest: any[]): any {
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

  return a as TClient & IRedisClient;
}

/**
 * Adds `runCommand` and structured overrides to an ioredis ChainableCommander
 * so it satisfies {@link IRedisTransaction}.
 */
function augmentTransaction(commander: ChainableCommander): IRedisTransaction {
  const a = commander as any;
  a.runCommand = function (name: string, args: any[]): any {
    a[name](args);
    return a;
  };

  // hset(key, { f1: v1 }) → ioredis pipeline.hset(key, f1, v1, …)
  const origHset = a.hset.bind(a);
  a.hset = function (key: string, data: Record<string, string | number>): any {
    const args: (string | number)[] = [key];
    for (const [f, v] of Object.entries(data)) {
      args.push(f, v);
    }
    origHset(...args);
    return a;
  };

  // hscan(key, cursor, { COUNT? }) → ioredis hscan(key, cursor, 'COUNT', n)
  const origHscan = a.hscan.bind(a);
  a.hscan = function (
    key: string,
    cursor: string | number,
    options?: { COUNT?: number },
  ): any {
    if (options?.COUNT != null) {
      origHscan(key, cursor, 'COUNT', options.COUNT);
    } else {
      origHscan(key, cursor);
    }
    return a;
  };

  // sscan(key, cursor, { COUNT? })
  const origSscan = a.sscan.bind(a);
  a.sscan = function (
    key: string,
    cursor: string | number,
    options?: { COUNT?: number },
  ): any {
    if (options?.COUNT != null) {
      origSscan(key, cursor, 'COUNT', options.COUNT);
    } else {
      origSscan(key, cursor);
    }
    return a;
  };

  return a as IRedisTransaction;
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
