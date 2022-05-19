import { RepeatOptions } from '../interfaces/repeat-options';
import { CronStrategy } from '../types/cron-strategy';
import { parseExpression } from 'cron-parser';

export interface CronStrategies {
  [index: string]: CronStrategy;
}

export class Crons {
  static getNextMillis(millis: number, opts: RepeatOptions): number {
    if (opts.cron && opts.every) {
      throw new Error(
        'Both .cron and .every options are defined for this repeatable job',
      );
    }

    if (opts.every) {
      return (
        Math.floor(millis / opts.every) * opts.every +
        (opts.immediately ? 0 : opts.every)
      );
    }

    const currentDate =
      opts.startDate && new Date(opts.startDate) > new Date(millis)
        ? new Date(opts.startDate)
        : new Date(millis);
    const interval = parseExpression(opts.cron, {
      ...opts,
      currentDate,
    });

    try {
      return interval.next().getTime();
    } catch (e) {
      // Ignore error
    }
  }

  static calculate(
    repeatOptions: RepeatOptions,
    customStrategies: CronStrategies,
    millis: number,
  ): number {
    if (repeatOptions) {
      const strategy = lookupStrategy(repeatOptions, customStrategies);

      return strategy(millis, repeatOptions);
    }
  }
}

function lookupStrategy(
  repeatOptions: RepeatOptions,
  customStrategies: CronStrategies,
): CronStrategy {
  if (repeatOptions.type in (customStrategies || {})) {
    return customStrategies[repeatOptions.type];
  } else if (
    repeatOptions.type === 'default' ||
    typeof repeatOptions.type === 'undefined'
  ) {
    return Crons.getNextMillis;
  } else {
    throw new Error(
      `Unknown cron strategy ${repeatOptions.type}.
      If a custom cron strategy is used, specify it when the queue is created.`,
    );
  }
}
