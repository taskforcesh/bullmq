import { Redis } from 'ioredis';

export const errorObject: { [index: string]: any } = { value: null };

export function tryCatch(fn: (...args: any) => any, ctx: any, args: any[]) {
  try {
    return fn.apply(ctx, args);
  } catch (e) {
    errorObject.value = e;
    return errorObject;
  }
}

export function isEmpty(obj: object) {
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      return false;
    }
  }
  return true;
}

export function array2obj(arr: string[]) {
  const obj: { [index: string]: string } = {};
  for (let i = 0; i < arr.length; i += 2) {
    obj[arr[i]] = arr[i + 1];
  }
  return obj;
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(() => resolve(), ms);
  });
}

export function isRedisInstance(obj: any): boolean {
  if (!obj) {
    return false;
  }
  const redisApi = ['connect', 'disconnect', 'duplicate'];
  return redisApi.every(name => typeof obj[name] === 'function');
}

export async function removeAllQueueData(
  client: Redis,
  queueName: string,
  prefix = 'bull',
) {
  const pattern = `${prefix}:${queueName}:*`;
  return new Promise((resolve, reject) => {
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
    stream.on('end', () => {
      resolve();
    });
    stream.on('error', error => {
      reject(error);
    });
  });
}
