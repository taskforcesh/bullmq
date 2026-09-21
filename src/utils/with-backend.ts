import { Queue } from '../classes/queue';
import { Worker } from '../classes/worker';
import { QueueEvents } from '../classes/queue-events';
import { QueueEventsProducer } from '../classes/queue-events-producer';
import { FlowProducer } from '../classes/flow-producer';
import type {
  BackendFactory,
  FlowProducerOptions,
  IQueueBackend,
  QueueEventsOptions,
  QueueEventsProducerOptions,
  QueueOptions,
  WorkerOptions,
} from '../interfaces';
import type { JobProgress } from '../types/job-progress';
import type { Processor } from '../types/processor';
import type {
  ExtractDataType,
  ExtractNameType,
  ExtractResultType,
} from '../types/queue-type';

/**
 * Constructors with a fixed backend and connection type, leaving job types
 * available as explicit type arguments.
 */
export interface BackendClasses<B extends IQueueBackend, C> {
  Queue: new <D = any, R = any, N extends string = string>(
    name: string,
    opts: QueueOptions<C>,
  ) => Queue<
    D,
    R,
    N,
    ExtractDataType<D, D>,
    ExtractResultType<D, R>,
    ExtractNameType<D, N>,
    B,
    C
  >;
  Worker: {
    new <
      D = any,
      R = any,
      N extends string = string,
      P extends JobProgress = JobProgress,
    >(
      name: string,
      processor: string | URL | null | Processor<D, R, N, P> | undefined,
      opts: WorkerOptions<C>,
    ): Worker<D, R, N, B, P, C>;
    RateLimitError: typeof Worker.RateLimitError;
  };
  QueueEvents: new <R = any>(
    name: string,
    opts: QueueEventsOptions<C>,
  ) => QueueEvents<R, B, C>;
  QueueEventsProducer: new (
    name: string,
    opts: QueueEventsProducerOptions<C>,
  ) => QueueEventsProducer<B, C>;
  FlowProducer: new (opts: FlowProducerOptions<C>) => FlowProducer<B, C>;
}

/**
 * Binds queue constructors to a backend without changing the process-wide
 * default. Connection options are required and checked against the factory.
 *
 * @example
 * ```typescript
 * const { Queue, Worker } = withBackend(createPostgresBackend);
 * const queue = new Queue<{ value: number }>('tasks', {
 *   connection: 'postgres://localhost/mydb',
 * });
 * ```
 */
export function withBackend<B extends IQueueBackend, C>(
  factory: BackendFactory<B, C>,
): BackendClasses<B, C> {
  class BackendQueue<D = any, R = any, N extends string = string> extends Queue<
    D,
    R,
    N,
    ExtractDataType<D, D>,
    ExtractResultType<D, R>,
    ExtractNameType<D, N>,
    B,
    C
  > {
    constructor(name: string, opts: QueueOptions<C>) {
      super(name, opts, factory);
    }
  }

  class BackendWorker<
    D = any,
    R = any,
    N extends string = string,
    P extends JobProgress = JobProgress,
  > extends Worker<D, R, N, B, P, C> {
    constructor(
      name: string,
      processor: string | URL | null | Processor<D, R, N, P> | undefined,
      opts: WorkerOptions<C>,
    ) {
      super(name, processor, opts, factory);
    }
  }

  class BackendQueueEvents<R = any> extends QueueEvents<R, B, C> {
    constructor(name: string, opts: QueueEventsOptions<C>) {
      super(name, opts, factory);
    }
  }

  class BackendQueueEventsProducer extends QueueEventsProducer<B, C> {
    constructor(name: string, opts: QueueEventsProducerOptions<C>) {
      super(name, opts, factory);
    }
  }

  class BackendFlowProducer extends FlowProducer<B, C> {
    constructor(opts: FlowProducerOptions<C>) {
      super(opts, factory);
    }
  }

  return {
    Queue: BackendQueue,
    Worker: BackendWorker,
    QueueEvents: BackendQueueEvents,
    QueueEventsProducer: BackendQueueEventsProducer,
    FlowProducer: BackendFlowProducer,
  };
}
