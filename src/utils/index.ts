import { Cluster, Redis } from 'ioredis';
import { AbortController } from '../classes/abort-controller';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { CONNECTION_CLOSED_ERROR_MSG } from 'ioredis/built/utils';
import {
  ChildMessage,
  ContextManager,
  ParentOptions,
  RedisClient,
  Span,
  Tracer,
} from '../interfaces';
import { EventEmitter } from 'events';
import * as semver from 'semver';

import { SpanKind, TelemetryAttributes } from '../enums';
import { DatabaseType } from '../types';

export const errorObject: { [index: string]: any } = { value: null };

/**
 * Invokes a function safely, returning an error sentinel instead of throwing.
 * @param fn - function to invoke
 * @param ctx - `this` context to apply to the function
 * @param args - arguments to pass to the function
 * @returns the function's return value, or `errorObject` if it threw
 */
export function tryCatch(
  fn: (...args: any) => any,
  ctx: any,
  args: any[],
): any {
  try {
    return fn.apply(ctx, args);
  } catch (e) {
    errorObject.value = e;
    return errorObject;
  }
}

/**
 * Checks the size of string for ascii/non-ascii characters
 * @see https://stackoverflow.com/a/23318053/1347170
 * @param str -
 */
export function lengthInUtf8Bytes(str: string): number {
  return Buffer.byteLength(str, 'utf8');
}

/**
 * Checks if an object has no own enumerable properties.
 * @param obj - object to inspect
 * @returns `true` if the object has no own properties, otherwise `false`
 */
export function isEmpty(obj: object): boolean {
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      return false;
    }
  }
  return true;
}

/**
 * Converts a flat array of alternating key/value pairs into an object.
 * @param arr - flat array where even indexes are keys and odd indexes are values
 * @returns an object built from the key/value pairs
 */
export function array2obj(arr: string[]): Record<string, string> {
  const obj: { [index: string]: string } = {};
  for (let i = 0; i < arr.length; i += 2) {
    obj[arr[i]] = arr[i + 1];
  }
  return obj;
}

/**
 * Flattens an object into an array of alternating key/value entries, skipping `undefined` values.
 * @param obj - object to flatten
 * @returns a flat array of alternating keys and values
 */
export function objectToFlatArray(obj: Record<string, any>): string[] {
  const arr = [];
  for (const key in obj) {
    if (
      Object.prototype.hasOwnProperty.call(obj, key) &&
      obj[key] !== undefined
    ) {
      arr[arr.length] = key;
      arr[arr.length] = obj[key];
    }
  }
  return arr;
}

/**
 * Returns a promise that resolves after the given number of milliseconds.
 * @param ms - delay in milliseconds
 * @param abortController - optional controller used to resolve the promise early
 * @returns a promise that resolves once the timeout elapses or the signal aborts
 */
export function delay(
  ms: number,
  abortController?: AbortController,
): Promise<void> {
  return new Promise(resolve => {
    // eslint-disable-next-line prefer-const
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const callback = () => {
      abortController?.signal.removeEventListener('abort', callback);
      clearTimeout(timeout);
      resolve();
    };
    timeout = setTimeout(callback, ms);
    abortController?.signal.addEventListener('abort', callback);
  });
}

/**
 * Increases an emitter's max listener count by the given amount.
 * @param emitter - emitter whose max listeners will be adjusted
 * @param count - number of additional listeners to allow
 */
export function increaseMaxListeners(
  emitter: EventEmitter,
  count: number,
): void {
  const maxListeners = emitter.getMaxListeners();
  emitter.setMaxListeners(maxListeners + count);
}

type Invert<T extends Record<PropertyKey, PropertyKey>> = {
  [V in T[keyof T]]: {
    [K in keyof T]: T[K] extends V ? K : never;
  }[keyof T];
};

/**
 * Returns a new object with the keys and values of the input swapped.
 * @param obj - object whose keys and values will be inverted
 * @returns a new object where original values become keys and vice versa
 */
export function invertObject<T extends Record<PropertyKey, PropertyKey>>(
  obj: T,
): Invert<T> {
  return Object.entries(obj).reduce((result, [key, value]) => {
    (result as Record<PropertyKey, PropertyKey>)[value] = key;
    return result;
  }, {} as Invert<T>);
}

export const optsDecodeMap = {
  de: 'deduplication',
  fpof: 'failParentOnFailure',
  cpof: 'continueParentOnFailure',
  idof: 'ignoreDependencyOnFailure',
  kl: 'keepLogs',
  rdof: 'removeDependencyOnFailure',
} as const;

export const optsEncodeMap = {
  ...invertObject(optsDecodeMap),
  /*/ Legacy for backwards compatibility */ debounce: 'de', // TODO: remove in next breaking change
} as const;

/**
 * Checks if the provided value looks like an ioredis Redis or Cluster instance.
 * @param obj - value to test
 * @returns `true` if the value exposes the expected Redis client API
 */
export function isRedisInstance(obj: any): obj is Redis | Cluster {
  if (!obj) {
    return false;
  }
  const redisApi = ['connect', 'disconnect', 'duplicate'];
  return redisApi.every(name => typeof obj[name] === 'function');
}

/**
 * Checks if the provided value is an ioredis Cluster instance.
 * @param obj - value to test
 * @returns `true` if the value is a Redis Cluster client
 */
export function isRedisCluster(obj: unknown): obj is Cluster {
  return isRedisInstance(obj) && (<Cluster>obj).isCluster;
}

/**
 * Decreases an emitter's max listener count by the given amount.
 * @param emitter - emitter whose max listeners will be adjusted
 * @param count - number of listeners to release
 */
export function decreaseMaxListeners(
  emitter: EventEmitter,
  count: number,
): void {
  increaseMaxListeners(emitter, -count);
}

/**
 * Removes every Redis key associated with a given queue.
 * @param client - Redis client used to scan and delete keys
 * @param queueName - queue whose keys will be removed
 * @param prefix - key prefix used by the queue
 * @returns a promise that resolves once keys are removed, or `false` for cluster clients
 */
export async function removeAllQueueData(
  client: RedisClient,
  queueName: string,
  prefix = process.env.BULLMQ_TEST_PREFIX || 'bull',
): Promise<void | boolean> {
  if (client instanceof Cluster) {
    // todo compat with cluster ?
    // @see https://github.com/luin/ioredis/issues/175
    return Promise.resolve(false);
  }
  const pattern = `${prefix}:${queueName}:*`;
  const pendingOperations: Promise<any>[] = [];

  await new Promise<void>((resolve, reject) => {
    const stream = client.scanStream({
      match: pattern,
    });
    stream.on('data', (keys: string[]) => {
      if (keys.length) {
        const pipeline = client.pipeline();
        keys.forEach(key => {
          pipeline.del(key);
        });
        const execPromise = pipeline.exec().catch(error => {
          reject(error);
          throw error;
        });
        pendingOperations.push(execPromise);
      }
    });
    stream.on('end', () => resolve());
    stream.on('error', error => reject(error));
  });

  // Wait for all pipeline operations to complete before closing the connection
  await Promise.all(pendingOperations);

  // Handle connection close with better error handling for Dragonfly
  try {
    await client.quit();
  } catch (error) {
    if (isNotConnectionError(error as Error)) {
      throw error;
    }
  }
}

/**
 * Builds the Redis key that identifies a parent job from its options.
 * @param opts - parent options containing the parent queue and id
 * @returns the `queue:id` parent key, or `undefined` when no options are provided
 */
export function getParentKey(opts: ParentOptions): string | undefined {
  if (opts) {
    return `${opts.queue}:${opts.id}`;
  }
}

export const clientCommandMessageReg =
  /ERR unknown command ['`]\s*client\s*['`]/;

export const DELAY_TIME_5 = 5000;

export const DELAY_TIME_1 = 100;

/**
 * Determines whether the given error is unrelated to a Redis connection drop.
 * @param error - error to classify
 * @returns `true` if the error is not a known connection close/refused error
 */
export function isNotConnectionError(error: Error): boolean {
  const { code, message: errorMessage } = error as any;
  return (
    errorMessage !== CONNECTION_CLOSED_ERROR_MSG &&
    !errorMessage.includes('ECONNREFUSED') &&
    code !== 'ECONNREFUSED'
  );
}

interface procSendLike {
  send?(message: any, callback?: (error: Error | null) => void): boolean;
  postMessage?(message: any): void;
}

/**
 * Sends a message through a process- or worker-like channel as a promise.
 * @param proc - target that exposes `send` or `postMessage`
 * @param msg - payload to transmit
 * @returns a promise that resolves once the message has been delivered
 */
export const asyncSend = <T extends procSendLike>(
  proc: T,
  msg: any,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (typeof proc.send === 'function') {
      proc.send(msg, (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    } else if (typeof proc.postMessage === 'function') {
      resolve(proc.postMessage(msg));
    } else {
      resolve();
    }
  });
};

/**
 * Sends a message to a child process and resolves once it has been delivered.
 * @param proc - child process to send to
 * @param msg - child message payload
 * @returns a promise that resolves after the send completes
 */
export const childSend = (
  proc: NodeJS.Process,
  msg: ChildMessage,
): Promise<void> => asyncSend<NodeJS.Process>(proc, msg);

/**
 * Checks whether a Redis-compatible server version is below a minimum for the desired database type.
 * @param currentVersion - version reported by the connected server
 * @param minimumVersion - minimum semver version required
 * @param currentDatabaseType - database type currently in use
 * @param desiredDatabaseType - database type the comparison applies to
 * @returns `true` if the database type matches and the version is lower than the minimum
 */
export const isRedisVersionLowerThan = (
  currentVersion: string,
  minimumVersion: string,
  currentDatabaseType: DatabaseType,
  desiredDatabaseType: DatabaseType = 'redis',
): boolean => {
  if (currentDatabaseType === desiredDatabaseType) {
    const version = semver.valid(semver.coerce(currentVersion)) as string;

    return semver.lt(version, minimumVersion);
  }
  return false;
};

/**
 * Parses every string value of an object as JSON.
 * @param obj - object whose values are JSON-encoded strings
 * @returns a new object with each value parsed into its JavaScript representation
 */
export const parseObjectValues = (obj: {
  [key: string]: string;
}): Record<string, any> => {
  const accumulator: Record<string, any> = {};
  for (const value of Object.entries(obj)) {
    accumulator[value[0]] = JSON.parse(value[1]);
  }

  return accumulator;
};

const getCircularReplacer = (rootReference: any) => {
  const references = new WeakSet();
  references.add(rootReference);
  return (_: string, value: any) => {
    if (typeof value === 'object' && value !== null) {
      if (references.has(value)) {
        return '[Circular]';
      }
      references.add(value);
    }
    return value;
  };
};

/**
 * Serializes an Error (including non-enumerable fields) into a plain JSON-safe object.
 * @param value - error or error-like value to serialize
 * @returns a plain object representation with circular references replaced by `[Circular]`
 */
export const errorToJSON = (value: any): Record<string, any> => {
  const error: Record<string, any> = {};

  Object.getOwnPropertyNames(value).forEach(function (propName: string) {
    error[propName] = value[propName];
  });

  return JSON.parse(JSON.stringify(error, getCircularReplacer(value)));
};

const INFINITY = 1 / 0;

/**
 * Converts any value to a string, preserving `-0` and recursing into arrays.
 * @param value - value to stringify
 * @returns the string representation of the value, or an empty string for nullish input
 */
export const toString = (value: any): string => {
  if (value == null) {
    return '';
  }
  // Exit early for strings to avoid a performance hit in some environments.
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    // Recursively convert values (susceptible to call stack limits).
    return `${value.map(other => (other == null ? other : toString(other)))}`;
  }
  if (
    typeof value == 'symbol' ||
    Object.prototype.toString.call(value) == '[object Symbol]'
  ) {
    return value.toString();
  }
  const result = `${value}`;
  return result === '0' && 1 / value === -INFINITY ? '-0' : result;
};

export const QUEUE_EVENT_SUFFIX = ':qe';

/**
 * Returns a shallow copy of the object with `undefined` fields omitted.
 * @param obj - object to filter
 * @returns a new object containing only the defined properties
 */
export function removeUndefinedFields<T extends Record<string, any>>(
  obj: Record<string, any>,
) {
  const newObj: any = {};
  for (const key in obj) {
    if (obj[key] !== undefined) {
      newObj[key] = obj[key];
    }
  }
  return newObj as T;
}

/**
 * Wraps the code with telemetry and provides a span for configuration.
 *
 * @param telemetry - telemetry configuration. If undefined, the callback will be executed without telemetry.
 * @param spanKind - kind of the span: Producer, Consumer, Internal
 * @param queueName - queue name
 * @param operation - operation name (such as add, process, etc)
 * @param destination - destination name (normally the queue name)
 * @param callback - code to wrap with telemetry
 * @param srcPropagationMetadata -
 * @returns
 */
export async function trace<T>(
  telemetry:
    | {
        tracer: Tracer;
        contextManager: ContextManager;
      }
    | undefined,
  spanKind: SpanKind,
  queueName: string,
  operation: string,
  destination: string,
  callback: (span?: Span, dstPropagationMetadata?: string) => Promise<T> | T,
  srcPropagationMetadata?: string,
) {
  if (!telemetry) {
    return callback();
  } else {
    const { tracer, contextManager } = telemetry;

    const currentContext = contextManager.active();

    let parentContext;
    if (srcPropagationMetadata) {
      parentContext = contextManager.fromMetadata(
        currentContext,
        srcPropagationMetadata,
      );
    }

    const spanName = destination ? `${operation} ${destination}` : operation;
    const span = tracer.startSpan(
      spanName,
      {
        kind: spanKind,
      },
      parentContext,
    );

    try {
      span.setAttributes({
        [TelemetryAttributes.QueueName]: queueName,
        [TelemetryAttributes.QueueOperation]: operation,
      });

      let messageContext;
      let dstPropagationMetadata: undefined | string;

      if (spanKind === SpanKind.CONSUMER && parentContext) {
        messageContext = span.setSpanOnContext(parentContext);
      } else {
        messageContext = span.setSpanOnContext(currentContext);
      }

      if (callback.length == 2) {
        dstPropagationMetadata = contextManager.getMetadata(messageContext);
      }

      return await contextManager.with(messageContext, () =>
        callback(span, dstPropagationMetadata),
      );
    } catch (err) {
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  }
}
