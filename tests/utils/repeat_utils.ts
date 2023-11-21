import { createHash } from 'crypto';

export function createRepeatableJobKey(
  jobName: string,
  jobId: string,
  endDate: string,
  tz: string,
  suffix: number,
) {
  return `${jobName}:${jobId}:${endDate}:${tz}:${suffix}`;
}

export function getRepeatableJobKeyPrefix(prefix: string, queueName: string) {
  return `${prefix}:${queueName}:repeat:`;
}

export function extractRepeatableJobChecksumFromRedisKey(
  redisKey: string,
): string {
  return redisKey.split(':')[3];
}

export function hash(repeatKeyHashAlgorithm: string, payload: string) {
  return createHash(repeatKeyHashAlgorithm).update(payload).digest('hex');
}

export function getRepeatJobIdCheckum(
  name: string,
  repeatJobKey: string,
  repeatKeyHashAlgorithm: string,
  jobId?: string,
) {
  const namespace = hash(repeatKeyHashAlgorithm, repeatJobKey);
  return hash(repeatKeyHashAlgorithm, `${name}${jobId || ''}${namespace}`);
}
