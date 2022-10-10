import { Job } from './job';
import { BackoffOptions } from '../interfaces/backoff-options';
import { BackoffStrategy } from '../types';

interface BuiltInStrategies {
  [index: string]: (delay: number) => BackoffStrategy;
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
        return Math.round((Math.pow(2, attemptsMade) - 1) * delay);
      };
    },
  };

  static normalize(backoff: number | BackoffOptions): BackoffOptions {
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
    job: Job,
    customStrategy?: BackoffStrategy,
  ): Promise<number> | number {
    if (backoff) {
      const strategy = lookupStrategy(backoff, customStrategy);

      return strategy(attemptsMade, backoff.type, err, job);
    }
  }
}

function lookupStrategy(
  backoff: BackoffOptions,
  customStrategy: BackoffStrategy,
): BackoffStrategy {
  if (backoff.type in Backoffs.builtinStrategies) {
    return Backoffs.builtinStrategies[backoff.type](backoff.delay);
  } else if (customStrategy) {
    return customStrategy;
  } else {
    throw new Error(
      `Unknown backoff strategy ${backoff.type}.
      If a custom backoff strategy is used, specify it when the queue is created.`,
    );
  }
}
