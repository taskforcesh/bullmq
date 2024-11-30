from bullmq.types import BackoffOptions

import math


class Backoffs:

    builtin_strategies = {
        "fixed": lambda delay: lambda attempts_made, type, err, job: delay,
        "exponential": lambda delay: lambda attempts_made, type, err, job: int(round(pow(2, attempts_made - 1) * delay))
    }    

    @staticmethod
    def normalize(backoff: int | BackoffOptions):
        if type(backoff) == int and math.isfinite(backoff):
            return {
                "type": "fixed",
                "delay": backoff
            }
        elif backoff:
            return backoff

    @staticmethod
    async def calculate(backoff: BackoffOptions, attempts_made: int, err, job, customStrategy):
        if backoff:
            strategy = lookup_strategy(backoff, customStrategy)
            return strategy(attempts_made, backoff.get("type"), err, job)


def lookup_strategy(backoff: BackoffOptions, custom_strategy):
    backoff_type = backoff.get("type")
    if backoff_type in Backoffs.builtin_strategies:
        return Backoffs.builtin_strategies[backoff_type](backoff.get("delay"))
    elif custom_strategy:
        return custom_strategy
    else:
        raise Exception(f"Unknown backoff strategy {backoff_type}. " +
                        "If a custom backoff strategy is used, specify it when the queue is created.")
