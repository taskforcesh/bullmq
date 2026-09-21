import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import {
  FlowProducer,
  JobScheduler,
  Queue,
  QueueBase,
  QueueBaseOptions,
  QueueEvents,
  QueueEventsProducer,
  QueueGetters,
  Worker,
  setDefaultBackendFactory,
  withBackend,
} from '../src';

const constructors = [
  { name: 'QueueBase', Constructor: QueueBase, prefix: ['tasks'] },
  { name: 'QueueGetters', Constructor: QueueGetters, prefix: ['tasks'] },
  { name: 'Queue', Constructor: Queue, prefix: ['tasks'] },
  { name: 'QueueEvents', Constructor: QueueEvents, prefix: ['tasks'] },
  {
    name: 'QueueEventsProducer',
    Constructor: QueueEventsProducer,
    prefix: ['tasks'],
  },
  { name: 'FlowProducer', Constructor: FlowProducer, prefix: [] },
  { name: 'Worker', Constructor: Worker, prefix: ['tasks', undefined] },
  { name: 'JobScheduler', Constructor: JobScheduler, prefix: ['tasks'] },
];

describe('backend constructor connection options', () => {
  afterEach(() => setDefaultBackendFactory());

  describe.each(constructors)('$name', ({ Constructor, prefix }) => {
    it.each([
      undefined,
      null,
      {},
      { connection: undefined },
      { connection: null },
    ])(
      'rejects missing connection options (%j) before calling an explicit factory',
      opts => {
        const factory = vi.fn(
          (_name: string, _opts: QueueBaseOptions<{ endpoint: string }>) => {
            throw new Error('Factory should not be called');
          },
        );
        expect(() =>
          Reflect.construct(Constructor, [...prefix, opts, factory]),
        ).toThrow(
          /Connection options are required|Worker requires a connection/,
        );
        expect(factory).not.toHaveBeenCalled();
      },
    );

    it('rejects missing options with a process-wide custom backend', () => {
      const factory = vi.fn(() => {
        throw new Error('Factory should not be called');
      });
      setDefaultBackendFactory(factory);
      expect(() => Reflect.construct(Constructor, prefix)).toThrow(
        /Connection options are required|Worker requires a connection/,
      );
      expect(factory).not.toHaveBeenCalled();
    });
  });

  it('rejects missing options for backend-bound constructors at runtime', () => {
    const factory = vi.fn(
      (_name: string, _opts: QueueBaseOptions<{ endpoint: string }>) => {
        throw new Error('Factory should not be called');
      },
    );
    const bound = withBackend(factory);
    for (const { Constructor, prefix } of [
      { Constructor: bound.Queue, prefix: ['tasks'] },
      { Constructor: bound.Worker, prefix: ['tasks', undefined] },
      { Constructor: bound.QueueEvents, prefix: ['tasks'] },
      { Constructor: bound.QueueEventsProducer, prefix: ['tasks'] },
      { Constructor: bound.FlowProducer, prefix: [] },
    ]) {
      expect(() => Reflect.construct(Constructor, prefix)).toThrow(
        /Connection options are required|Worker requires a connection/,
      );
    }
    expect(factory).not.toHaveBeenCalled();
  });

  it('preserves no-options Redis constructors', async () => {
    const name = `defaults-${randomUUID()}`;
    const queue = new Queue(name);
    const instances = [
      queue,
      new QueueBase(name),
      new QueueGetters(name),
      new QueueEvents(name),
      new QueueEventsProducer(name),
      new FlowProducer(),
    ];
    try {
      await Promise.all(instances.map(instance => instance.waitUntilReady()));
      for (const instance of instances) {
        expect(instance.opts.connection).toEqual({});
      }
      await queue.obliterate({ force: true });
    } finally {
      await Promise.all(instances.map(instance => instance.close()));
    }
  });
});
