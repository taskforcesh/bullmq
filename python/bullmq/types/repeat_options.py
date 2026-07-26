"""
Type definitions for job schedulers (repeatable jobs).
"""
from typing import Optional, TypedDict, Union


class RepeatOptions(TypedDict, total=False):
    """
    Options that describe how a job scheduler repeats.

    Exactly one of `pattern` or `every` must be supplied:
      - `pattern` is a cron expression evaluated with `croniter`.
      - `every` is the interval in milliseconds between iterations.
    """

    pattern: str
    """A cron expression. Mutually exclusive with `every`."""

    every: int
    """Repeat interval in milliseconds. Mutually exclusive with `pattern`."""

    limit: int
    """Maximum number of iterations to produce."""

    startDate: Union[int, str, float]
    """When to start, as epoch millis or ISO timestamp."""

    endDate: Union[int, str, float]
    """When to stop producing iterations."""

    tz: str
    """Timezone used to evaluate `pattern` (e.g. `Europe/Stockholm`)."""

    offset: int
    """For `every`-based schedules, an offset in ms applied to the time slot."""

    immediately: bool
    """Run a first iteration immediately (only meaningful for `pattern`)."""

    count: int
    """Iteration counter; managed by the scheduler, not user-set."""


class JobSchedulerTemplateJson(TypedDict, total=False):
    """Snapshot of the template (data + opts) attached to a scheduler."""

    data: object
    opts: dict


class JobSchedulerJson(TypedDict, total=False):
    """
    JSON-shaped scheduler record returned by `getJobScheduler` /
    `getJobSchedulers`. Mirrors the Node `JobSchedulerJson` interface.
    """

    key: str
    name: str
    next: Optional[int]
    id: Optional[str]
    iterationCount: int
    limit: int
    startDate: int
    endDate: int
    tz: str
    pattern: str
    every: int
    offset: int
    template: JobSchedulerTemplateJson
