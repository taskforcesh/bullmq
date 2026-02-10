import { describe, it, expect, vi } from 'vitest';
import { Queue } from '../src';

describe('Repeat/JobScheduler error forwarding', () => {
  it('Queue should forward Repeat "error" to queue.on("error")', async () => {
    const queue = new Queue('test-forward-repeat');

    // Force repeat instance creation so the buggy listener is attached
    await queue.repeat;

    const spy = vi.fn();
    queue.on('error', spy);

    const err = new Error('repeat boom');

    // Trigger the child error event directly
    (queue as any)._repeat.emit('error', err);

    // This EXPECTATION FAILS on current buggy code (spy called 0 times)
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(err);

    await queue.close();
  });

  it('Queue should forward JobScheduler "error" to queue.on("error")', async () => {
    const queue = new Queue('test-forward-scheduler');

    // Force jobScheduler instance creation so the buggy listener is attached
    await queue.jobScheduler;

    const spy = vi.fn();
    queue.on('error', spy);

    const err = new Error('scheduler boom');

    // Trigger the child error event directly
    (queue as any)._jobScheduler.emit('error', err);

    // This EXPECTATION FAILS on current buggy code (spy called 0 times)
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(err);

    await queue.close();
  });
});
