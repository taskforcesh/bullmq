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
    it.each([false, 0, '', { endpoint: 'localhost' }] as const)(
      'passes the connection (%j) unchanged to the factory',
      connection => {
        const reachedFactory = new Error('Factory reached');
        const factory = vi.fn(
          (_name: string, _opts: QueueBaseOptions<typeof connection>) => {
            throw reachedFactory;
          },
        );
        expect(() =>
          Reflect.construct(Constructor, [...prefix, { connection }, factory]),
        ).toThrow(reachedFactory);
        expect(factory).toHaveBeenCalledTimes(1);
        expect(factory.mock.calls[0][1].connection).toBe(connection);
      },
    );

    it.each([
      [undefined, {}],
      [null, undefined],
      [{}, undefined],
      [{ connection: undefined }, undefined],
      [{ connection: null }, null],
    ])(
      'forwards missing connection options (%j) to an explicit factory',
      (opts, expected) => {
        const reachedFactory = new Error('Factory reached');
        const factory = vi.fn((_name: string, _opts: QueueBaseOptions) => {
          throw reachedFactory;
        });
        if (Constructor === Worker) {
          expect(() =>
            Reflect.construct(Constructor, [...prefix, opts, factory]),
          ).toThrow('Worker requires a connection');
          expect(factory).not.toHaveBeenCalled();
          return;
        }
        expect(() =>
          Reflect.construct(Constructor, [...prefix, opts, factory]),
        ).toThrow(reachedFactory);
        expect(factory.mock.calls[0][1].connection).toEqual(expected);
      },
    );

    it('uses a process-wide custom backend when options are omitted', () => {
      const reachedFactory = new Error('Factory reached');
      const factory = vi.fn((_name: string, _opts: QueueBaseOptions) => {
        throw reachedFactory;
      });
      setDefaultBackendFactory(factory);
      if (Constructor === Worker) {
        expect(() => Reflect.construct(Constructor, prefix)).toThrow(
          'Worker requires a connection',
        );
        expect(factory).not.toHaveBeenCalled();
        return;
      }
      expect(() => Reflect.construct(Constructor, prefix)).toThrow(
        reachedFactory,
      );
      expect(factory.mock.calls[0][1].connection).toEqual({});
    });
  });

  it('preserves no-options Redis constructors', async () => {
    const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
    // Keep the test hash tag in the name since this test must omit options.
    const name = `${prefix}-defaults-${randomUUID()}`;
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
