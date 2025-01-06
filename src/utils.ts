import { Cluster, Redis } from 'ioredis';

// Note: this Polyfill is only needed for Node versions < 15.4.0
import { AbortController } from 'node-abort-controller';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { CONNECTION_CLOSED_ERROR_MSG } from 'ioredis/built/utils';
import {
  Attributes,
  ChildMessage,
  ContextManager,
  Meter,
  RedisClient,
  Span,
  Telemetry,
  Tracer,
} from './interfaces';
import { EventEmitter } from 'events';
import * as semver from 'semver';

import { SpanKind, TelemetryAttributes } from './enums';
import { JobsOptions, RedisJobOptions } from './types';

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

export const invertObject = (obj: Record<string, string>) => {
  return Object.entries(obj).reduce<Record<string, string>>(
    (encodeMap, [key, value]) => {
      encodeMap[value] = key;
      return encodeMap;
    },
    {},
  );
};

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
  const removing = await new Promise<void>((resolve, reject) => {
    const stream = client.scanStream({
      match: pattern,
    });
    stream.on('data', (keys: string[]) => {
      if (keys.length) {
        const pipeline = client.pipeline();
        keys.forEach(key => {
          pipeline.del(key);
        });
        pipeline.exec().catch(error => {
          reject(error);
        });
      }
    });
    stream.on('end', () => resolve());
    stream.on('error', error => reject(error));
  });
  await removing;
  await client.quit();
}

export function getParentKey(opts: {
  id: string;
  queue: string;
}): string | undefined {
  if (opts) {
    return `${opts.queue}:${opts.id}`;
  }
}

export const clientCommandMessageReg =
  /ERR unknown command ['`]\s*client\s*['`]/;

export const DELAY_TIME_5 = 5000;

export const DELAY_TIME_1 = 100;

export function isNotConnectionError(error: Error): boolean {
  const errorMessage = `${(error as Error).message}`;
  return (
    errorMessage !== CONNECTION_CLOSED_ERROR_MSG &&
    !errorMessage.includes('ECONNREFUSED')
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
): boolean => {
  const version = semver.valid(semver.coerce(currentVersion)) as string;

  return semver.lt(version, minimumVersion);
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

const optsDecodeMap = {
  de: 'deduplication',
  fpof: 'failParentOnFailure',
  idof: 'ignoreDependencyOnFailure',
  kl: 'keepLogs',
  rdof: 'removeDependencyOnFailure',
  tm: 'telemetryMetadata',
};

const optsEncodeMap = invertObject(optsDecodeMap);
optsEncodeMap.debounce = 'de';

export function optsAsJSON(opts: JobsOptions = {}): RedisJobOptions {
  const optionEntries = Object.entries(opts) as Array<[keyof JobsOptions, any]>;
  const options: Partial<Record<string, any>> = {};
  for (const item of optionEntries) {
    const [attributeName, value] = item;
    if (value !== undefined) {
      if ((optsEncodeMap as Record<string, any>)[<string>attributeName]) {
        options[(optsEncodeMap as Record<string, any>)[<string>attributeName]] =
          value;
      } else {
        options[<string>attributeName] = value;
      }
    }
  }

  return options as RedisJobOptions;
}

export function optsFromJSON(rawOpts?: string): JobsOptions {
  const opts = JSON.parse(rawOpts || '{}');

  const optionEntries = Object.entries(opts) as Array<
    [keyof RedisJobOptions, any]
  >;

  const options: Partial<Record<string, any>> = {};
  for (const item of optionEntries) {
    const [attributeName, value] = item;
    if ((optsDecodeMap as Record<string, any>)[<string>attributeName]) {
      options[(optsDecodeMap as Record<string, any>)[<string>attributeName]] =
        value;
    } else {
      options[<string>attributeName] = value;
    }
  }

  return options as JobsOptions;
}

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
  tracer: Tracer | undefined,
  contextManager: ContextManager | undefined,
  spanKind: SpanKind,
  queueName: string,
  operation: string,
  destination: string,
  callback: (
    span?: Span,
    dstPropagationMetadata?: string,
    attributes?: Attributes,
  ) => Promise<T> | T,
  srcPropagationMetadata?: string,
) {
  if (!tracer) {
    return callback();
  } else {
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
      const attributes = {
        [TelemetryAttributes.QueueName]: queueName,
        [TelemetryAttributes.QueueOperation]: operation,
      };

      span.setAttributes(attributes);

      let messageContext: any;
      let dstPropagationMetadata: undefined | string;

      if (spanKind === SpanKind.CONSUMER && parentContext) {
        messageContext = span.setSpanOnContext(parentContext);
      } else {
        messageContext = span.setSpanOnContext(currentContext);
      }

      if (callback.length >= 2) {
        dstPropagationMetadata = contextManager.getMetadata(messageContext);
      }

      return await contextManager.with(messageContext, () =>
        callback(span, dstPropagationMetadata, attributes),
      );
    } catch (err) {
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  }
}

/**
 * Wraps the code with metrics.
 *
 * @param metrics - metrics configuration. If undefined, the callback will be executed without metrics.
 * @param queueName - queue name
 * @param operation - operation name (such as add, process, etc)
 * @param callback - code to wrap with metrics
 * @returns
 */
export async function metric<T>(
  meter: Meter | undefined,
  queueName: string,
  operation: string,
  span: Span,
  dstPropagationMetadata: string,
  attributes: Attributes,
  callback: (span?: Span, dstPropagationMetadata?: string) => Promise<T> | T,
) {
  if (!meter && span) {
    return callback(span, dstPropagationMetadata);
  } else if (!meter) {
    return callback();
  } else {
    const start = Date.now();

    const histogram = meter.createHistogram(
      `bullmq.histogram.${queueName}.${operation}`,
      {
        description: `histogram for the ${queueName} ${operation}`,
        unit: 'ms',
      },
    );

    const counter = meter.createCounter(
      `bullmq.counter.${queueName}.${operation}`,
      {
        description: `counter for the ${queueName} ${operation}`,
      },
    );

    const counterError = meter.createCounter(
      `bullmq.counter.error.${queueName}.${operation}`,
      {
        description: `error counter for the ${queueName} ${operation}`,
      },
    );

    let result;
    try {
      result = await callback(span, dstPropagationMetadata);
    } catch (err) {
      const end = Date.now();
      histogram.record(end - start, attributes);

      counterError.add(1, attributes);
      throw err;
    } finally {
      const end = Date.now();
      histogram.record(end - start, attributes);

      counter.add(1, attributes);
    }
    return result;
  }
}

export async function telemetry<T>(
  callback: (span?: Span, dstPropagationMetadata?: string) => Promise<T> | T,
  opts?: {
    telemetry?: Telemetry;
    spanKind: SpanKind;
    queueName: string;
    operation: string;
    destination: string;
    srcPropagationMetadata?: string;
  },
) {
  if (opts) {
    const {
      telemetry,
      spanKind,
      queueName,
      operation,
      destination,
      srcPropagationMetadata,
    } = opts;
    return await trace(
      telemetry?.tracer,
      telemetry?.contextManager,
      spanKind,
      queueName,
      operation,
      destination,
      async (span, dstPropagationMetadata, context) => {
        return await metric(
          telemetry?.meter,
          queueName,
          operation,
          span,
          dstPropagationMetadata,
          context,
          callback,
        );
      },
      srcPropagationMetadata,
    );
  } else {
    return await callback();
  }
}
