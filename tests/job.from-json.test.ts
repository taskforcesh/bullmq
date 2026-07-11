import { describe, expect, it } from 'vitest';

import { Job } from '../src/classes';

const fakeQueue: any = {
  name: 'test-queue',
  qualifiedName: 'bull:test-queue',
  keys: {},
  opts: {},
  closing: undefined,
  backend: {},
  toKey: (key: string) => `bull:test-queue:${key}`,
  emit: () => true,
  on: () => fakeQueue,
  removeListener: () => fakeQueue,
  waitUntilReady: async () => undefined,
  trace: async (_spanKind: unknown, _op: string, _dest: string, cb: any) =>
    cb(),
};

describe('Job.fromJSON', () => {
  it('restores deduplicationId from legacy debounceId payloads', () => {
    const job = Job.fromJSON(fakeQueue, {
      name: 'test',
      data: '{}',
      opts: {},
      debounceId: 'legacy-dedup-id',
    } as any);

    expect(job.deduplicationId).toBe('legacy-dedup-id');
  });

  it('prefers deduplicationId when both ids are present', () => {
    const job = Job.fromJSON(fakeQueue, {
      name: 'test',
      data: '{}',
      opts: {},
      deduplicationId: 'current-id',
      debounceId: 'legacy-id',
    } as any);

    expect(job.deduplicationId).toBe('current-id');
  });
});
