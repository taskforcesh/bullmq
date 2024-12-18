import { MinimalJob } from '../interfaces/minimal-job';

export type BackoffStrategy4 = (
  attemptsMade: number,
  type: string,
  err: Error,
  job: MinimalJob,
) => Promise<number> | number;

export type BackoffStrategy3 = (
  attemptsMade: number,
  type: string,
  err: Error,
) => Promise<number> | number;

export type BackoffStrategy2 = (
  attemptsMade: number,
  type: string,
) => Promise<number> | number;

export type BackoffStrategy1 = (attemptsMade: number) => Promise<number> | number;

export type BackoffStrategy0 = () => Promise<number> | number;

export type BackoffStrategy =
  | BackoffStrategy4
  | BackoffStrategy3
  | BackoffStrategy2
  | BackoffStrategy1
  | BackoffStrategy0;
