export * from './classes';
export * from './commands';
export * from './enums';
export * from './interfaces';
export * from './types';
export * from './utils';

import type { Queue } from './classes/queue';
import type { Worker } from './classes/worker';
import type { Job } from './classes/job';

export type QueueWorker<Q> = Q extends Queue<
  infer DataType,
  infer ResultType,
  infer NameType
>
  ? Worker<DataType, ResultType, NameType>
  : unknown;

export type QueueJob<Q> = Q extends Queue<
  infer DataType,
  infer ResultType,
  infer NameType
>
  ? Job<DataType, ResultType, NameType>
  : unknown;
