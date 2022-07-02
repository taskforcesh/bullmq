import { RepeatOptions } from '../interfaces/repeat-options';

export type RepeatStrategy = (
  millis: number,
  opts: RepeatOptions,
  name?: string,
) => number;
