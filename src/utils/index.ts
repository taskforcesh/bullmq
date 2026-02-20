import { Cluster, Redis } from 'ioredis';

// Note: this Polyfill is only needed for Node versions < 15.4.0
import { AbortController } from 'node-abort-controller';

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

export function isEmpty(obj: object): boolean {
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      return false;
    }
  }
  return true;
}

export function array2obj(arr: string[]): Record<string, string> {
  const obj: { [index: string]: string } = {};
  for (let i = 0; i < arr.length; i += 2) {
    obj[arr[i]] = arr[i + 1];
  }
  return obj;
}

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

export function isRedisInstance(obj: any): obj is Redis | Cluster {
  if (!obj) {
    return false;
  }
  const redisApi = ['connect', 'disconnect', 'duplicate'];
  return redisApi.every(name => typeof obj[name] === 'function');
}

export function isRedisCluster(obj: unknown): obj is Cluster {
  return isRedisInstance(obj) && (<Cluster>obj).isCluster;
}

export function decreaseMaxListeners(
  emitter: EventEmitter,
  count: number,
): void {
  increaseMaxListeners(emitter, -count);
}

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

export function getParentKey(opts: ParentOptions): string | undefined {
  if (opts) {
    return `${opts.queue}:${opts.id}`;
  }
}

export const clientCommandMessageReg =
  /ERR unknown command ['`]\s*client\s*['`]/;

export const DELAY_TIME_5 = 5000;

export const DELAY_TIME_1 = 100;

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

export const childSend = (
  proc: NodeJS.Process,
  msg: ChildMessage,
): Promise<void> => asyncSend<NodeJS.Process>(proc, msg);

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

export const errorToJSON = (value: any): Record<string, any> => {
  const error: Record<string, any> = {};

  Object.getOwnPropertyNames(value).forEach(function (propName: string) {
    error[propName] = value[propName];
  });

  return JSON.parse(JSON.stringify(error, getCircularReplacer(value)));
};

const INFINITY = 1 / 0;

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
 * @param srcPropagationMedatada -
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
