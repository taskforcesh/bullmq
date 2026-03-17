import IORedis from 'ioredis';
import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import { v4 } from 'uuid';

import { FlowProducer } from '../src';
import { removeAllQueueData } from '../src/utils';

describe('FlowProducer deduplication', () => {
  const redisHost = process.env.REDIS_HOST || '127.0.0.1';

  let flowProducer: FlowProducer;
  let queueName: string;
  let prefix: string;

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    prefix = `bull-${v4()}`;

    const connection = new IORedis(redisHost, {
      maxRetriesPerRequest: null,
    });

    flowProducer = new FlowProducer({ connection, prefix });
  });

  afterEach(async () => {
    const client = await flowProducer.client;
    await removeAllQueueData(client, queueName);
    await flowProducer.close();
  });

  it('should reuse job when deduplication id is the same', async () => {
    const first = await flowProducer.add({
      name: 'job',
      queueName,
      data: {},
      opts: {
        deduplication: { id: 'dedup-1' },
      },
    });

    const second = await flowProducer.add({
      name: 'job',
      queueName,
      data: {},
      opts: {
        deduplication: { id: 'dedup-1' },
      },
    });

    expect(first.job.id).toBe(second.job.id);
  });

  it('should create different jobs for different deduplication ids', async () => {
    const first = await flowProducer.add({
      name: 'job',
      queueName,
      data: {},
      opts: {
        deduplication: { id: 'dedup-1' },
      },
    });

    const second = await flowProducer.add({
      name: 'job',
      queueName,
      data: {},
      opts: {
        deduplication: { id: 'dedup-2' },
      },
    });

    expect(first.job.id).not.toBe(second.job.id);
  });

  it('should prioritize jobId over deduplication id', async () => {
    const result = await flowProducer.add({
      name: 'job',
      queueName,
      data: {},
      opts: {
        jobId: 'job-1',
        deduplication: { id: 'dedup-1' },
      },
    });

    expect(result.job.id).toBe('job-1');
  });

  it('should create different jobs when no deduplication is provided', async () => {
    const first = await flowProducer.add({
      name: 'job',
      queueName,
      data: {},
    });

    const second = await flowProducer.add({
      name: 'job',
      queueName,
      data: {},
    });

    expect(first.job.id).not.toBe(second.job.id);
  });
});
