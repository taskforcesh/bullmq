import { BackoffOptions } from '../interfaces/backoff-options';

interface BuiltInStrategies {
  [index: string]: (delay: number) => BackoffFunction;
}

export interface Strategies {
  [index: string]: BackoffFunction;
}

export type BackoffFunction = (attemptsMade?: number, err?: Error) => number;

export class Backoffs {
  static builtinStrategies: BuiltInStrategies = {
    fixed: function(delay: number) {
      return function() {
        return delay;
      };
    },

    exponential: function(delay: number) {
      return function(attemptsMade: number) {
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
    customStrategies: Strategies,
    err: Error,
  ) {
    if (backoff) {
      const strategy = lookupStrategy(backoff, customStrategies);

      return strategy(attemptsMade, err);
    }
  }
}

function lookupStrategy(
  backoff: BackoffOptions,
  customStrategies: Strategies,
): BackoffFunction {
  if (backoff.type in (customStrategies || {})) {
    return customStrategies[backoff.type];
  } else if (backoff.type in Backoffs.builtinStrategies) {
    return Backoffs.builtinStrategies[backoff.type](backoff.delay);
  } else {
    throw new Error(
      `Unknown backoff strategy ${backoff.type}.
      If a custom backoff strategy is used, specify it when the queue is created.`,
    );
  }
}
