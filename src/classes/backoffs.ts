import { BackoffOptions, MinimalJob } from '../interfaces';
import { BackoffStrategy } from '../types';

export interface BuiltInStrategies {
  [index: string]: (delay: number, percentage?: number) => BackoffStrategy;
}

export class Backoffs {
  static builtinStrategies: BuiltInStrategies = {
    fixed: function (delay: number) {
      return function (): number {
        return delay;
      };
    },

    exponential: function (delay: number) {
      return function (attemptsMade: number): number {
        return Math.round(Math.pow(2, attemptsMade - 1) * delay);
      };
    },

    jitter: function (delay: number, percentage = 1) {
      return function (attemptsMade: number): number {
        const maxDelay = Math.round(Math.pow(2, attemptsMade - 1) * delay);
        const minDelay = maxDelay * (1 - percentage);

        return Math.floor(Math.random() * maxDelay * percentage + minDelay);
      };
    },
  };

  static normalize(
    backoff: number | BackoffOptions,
  ): BackoffOptions | undefined {
    if (Number.isFinite(<number>backoff)) {
      return {
        type: 'fixed',
        delay: <number>backoff,
      };
    } else if (backoff) {
      return <BackoffOptions>backoff;
    }
  }

  static calculate(
    backoff: BackoffOptions,
    attemptsMade: number,
    err: Error,
    job: MinimalJob,
    customStrategy?: BackoffStrategy,
  ): Promise<number> | number | undefined {
    if (backoff) {
      const strategy = lookupStrategy(backoff, customStrategy);

      return strategy(attemptsMade, backoff.type, err, job);
    }
  }
}

function lookupStrategy(
  backoff: BackoffOptions,
  customStrategy?: BackoffStrategy,
): BackoffStrategy {
  if (backoff.type in Backoffs.builtinStrategies) {
    return Backoffs.builtinStrategies[backoff.type](
      backoff.delay!,
      backoff.percentage,
    );
  } else if (customStrategy) {
    return customStrategy;
  } else {
    throw new Error(
      `Unknown backoff strategy ${backoff.type}.
      If a custom backoff strategy is used, specify it when the queue is created.`,
    );
  }
}
