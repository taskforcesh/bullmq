import { Cluster, Redis } from 'ioredis';

// Note: this Polyfill is only needed for Node versions < 15.4.0
import { AbortController } from 'node-abort-controller';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { CONNECTION_CLOSED_ERROR_MSG } from 'ioredis/built/utils';
import * as semver from 'semver';
import { ChildMessage, RedisClient } from './interfaces';

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

export async function removeAllQueueData(
  client: RedisClient,
  queueName: string,
  prefix = 'bull',
): Promise<void | boolean> {
  if (client instanceof Cluster) {
    // todo compat with cluster ?
    // @see https://github.com/luin/ioredis/issues/175
    return Promise.resolve(false);
  }
  const pattern = `${prefix}:${queueName}:*`;
  return new Promise<void>((resolve, reject) => {
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

export const errorToJSON = (value: any): Record<string, any> => {
  const error: Record<string, any> = {};

  Object.getOwnPropertyNames(value).forEach(function (propName: string) {
    error[propName] = value[propName];
  });

  return error;
};

export const WORKER_SUFFIX = '';

export const QUEUE_EVENT_SUFFIX = ':qe';
