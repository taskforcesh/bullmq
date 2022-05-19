import { RepeatOptions } from '../interfaces/repeat-options';

export type CronStrategy = (millis: number, opts: RepeatOptions) => number;
