import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChildProcessor } from '../src/classes/child-processor';
import { ChildCommand, ParentCommand } from '../src/enums';
import { JobJsonSandbox } from '../src/types';

class TestChildProcessor extends ChildProcessor {
  job(send: (msg: any) => Promise<void>) {
    return this.wrapJob({ data: '{}' } as JobJsonSandbox, send);
  }
}

describe('Sandboxed updateData responses', () => {
  afterEach(() => vi.useRealTimers());

  it('registers before sending and cleans up repeated immediate responses', async () => {
    const receiver = new EventEmitter();
    const send = async (msg: any) => {
      expect(msg.cmd).toBe(ParentCommand.Update);
      expect(receiver.listenerCount('message')).toBe(1);
      receiver.emit('message', {
        cmd: ChildCommand.UpdateDataResponse,
        requestId: msg.requestId,
      });
    };
    const job = new TestChildProcessor(send, receiver).job(send);

    for (let value = 0; value < 20; value++) {
      await job.updateData({ value });
      expect(receiver.listenerCount('message')).toBe(0);
      expect(job.data).toEqual({ value });
    }
  });

  it.each(['throw', 'reject'])(
    'cleans up when sending fails by %s',
    async mode => {
      const receiver = new EventEmitter();
      const error = new Error('IPC channel closed');
      let requestId: string;
      const send = (msg: any): Promise<void> => {
        requestId = msg.requestId;
        if (mode === 'throw') {
          throw error;
        }
        return Promise.reject(error);
      };
      const job = new TestChildProcessor(send, receiver).job(send);
      const updating = job.updateData({ updated: true });
      expect(job.data).toEqual({ updated: true });
      await expect(updating).rejects.toBe(error);
      expect(receiver.listenerCount('message')).toBe(0);
      receiver.emit('message', { requestId: requestId!, value: null });
      expect(receiver.listenerCount('message')).toBe(0);
    },
  );

  it('waits for persistence without adding an RPC timeout', async () => {
    vi.useFakeTimers();
    const receiver = new EventEmitter();
    let requestId: string;
    const send = async (msg: any) => {
      requestId = msg.requestId;
    };
    const job = new TestChildProcessor(send, receiver).job(send);
    let completed = false;
    const updating = job.updateData({ updated: true }).then(() => {
      completed = true;
    });
    await vi.advanceTimersByTimeAsync(6000);
    expect(completed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    receiver.emit('message', { requestId: requestId!, value: null });
    await updating;
    expect(receiver.listenerCount('message')).toBe(0);
  });

  it('returns persistence errors and removes the response listener', async () => {
    const receiver = new EventEmitter();
    const send = async (msg: any) => {
      receiver.emit('message', {
        requestId: msg.requestId,
        err: { name: 'TypeError', message: 'Cannot serialize data' },
      });
    };
    const job = new TestChildProcessor(send, receiver).job(send);
    await expect(job.updateData({ updated: true })).rejects.toMatchObject({
      name: 'TypeError',
      message: 'Cannot serialize data',
    });
    expect(job.data).toEqual({ updated: true });
    expect(receiver.listenerCount('message')).toBe(0);
  });

  it('keeps the timeout for existing RPCs and cleans up after it expires', async () => {
    vi.useFakeTimers();
    const receiver = new EventEmitter();
    const send = async () => {};
    const job = new TestChildProcessor(send, receiver).job(send);
    const rejected = expect(job.getChildrenValues()).rejects.toThrow(
      'TimeoutError: getChildrenValues timed out in (500ms)',
    );
    await vi.advanceTimersByTimeAsync(500);
    await rejected;
    expect(receiver.listenerCount('message')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
