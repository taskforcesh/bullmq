from bullmq.types import BackoffOptions

import math


class Backoffs:

    builtin_strategies = {
        "fixed": lambda delay: lambda : delay,
        "exponential": lambda delay: lambda attempts_made: int(round(pow(2, attempts_made - 1) * delay))
    }    


def normalize(backoff: int | BackoffOptions):
    if type(backoff) == int and math.isfinite(backoff):
        return {
            "type": 'fixed',
            "delay": backoff
        }
    elif backoff:
        return backoff


def lookup_strategy(backoff: BackoffOptions, custom_strategy):
    if backoff.type in Backoffs.builtin_strategies:
        Backoffs.builtin_strategies[backoff.type](backoff.delay)
    elif custom_strategy:
        return custom_strategy
    else:
        raise Exception(f"Unknown backoff strategy {backoff.type}.If a custom backoff strategy is used, specify it when the queue is created.")


def calculate(backoff: BackoffOptions, attempts_made: int, err, job, customStrategy):
    if backoff:
        strategy = lookup_strategy(backoff, customStrategy)

        return strategy(attempts_made, backoff.type, err, job)


Backoffs.normalize = staticmethod(normalize)


Backoffs.calculate = staticmethod(calculate)
