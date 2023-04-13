from redis import Redis
from typing import List, Any, TypedDict, Optional

import json
import time


optsDecodeMap = {
    'fpof': 'failParentOnFailure',
    'kl': 'keepLogs',
}

optsEncodeMap = {v: k for k, v in optsDecodeMap.items()}


class KeepJobs(TypedDict, total=False):
    """
    Specify which jobs to keep after finishing. If both age and count are
    specified, then the jobs kept will be the ones that satisfies both
    properties.
    """

    age: int
    """
    Maximum age in seconds for job to be kept.
    """

    count: int
    """
    Maximum count of jobs to be kept.
    """


class JobOptions(TypedDict, total=False):
    jobId: str
    """
    Override the job ID - by default, the job ID is a unique
    integer, but you can use this setting to override it.
    
    If you use this option, it is up to you to ensure the
    jobId is unique. If you attempt to add a job with an id that
    already exists, it will not be added.
    """

    timestamp: int
    """
    Timestamp when the job was created.

    @defaultValue round(time.time() * 1000)
    """

    delay: int
    """
    An amount of milliseconds to wait until this job can be processed.
    Note that for accurate delays, worker and producers
    should have their clocks synchronized.

    @defaultValue 0
    """

    attempts: int
    """
    The total number of attempts to try the job until it completes.
    
    @defaultValue 0
    """

    removeOnComplete: bool | int | KeepJobs
    """
    If true, removes the job when it successfully completes
    When given a number, it specifies the maximum amount of
    jobs to keep, or you can provide an object specifying max
    age and/or count to keep. It overrides whatever setting is used in the worker.
    Default behavior is to keep the job in the completed set.
    """

    removeOnFail: bool | int | KeepJobs
    """
    If true, removes the job when it fails after all attempts.
    When given a number, it specifies the maximum amount of
    jobs to keep, or you can provide an object specifying max
    age and/or count to keep. It overrides whatever setting is used in the worker.
    Default behavior is to keep the job in the failed set.
    """


class Job:
    """
    This class represents a Job in the queue. Normally job are implicitly created when
    you add a job to the queue with methods such as Queue.addJob( ... )

    A Job instance is also passed to the Worker's process function.
    """

    def __init__(self, client: Redis, name: str, data: Any, opts: JobOptions = {}):
        self.name = name
        self.id = opts.get("jobId", None)
        self.progress = 0
        self.timestamp = opts.get("timestamp", round(time.time() * 1000))
        self.opts = opts
        self.delay = opts.get("delay", 0)
        self.attempts = opts.get("attempts", 1)
        self.attemptsMade = 0
        self.data = data
        self.removeOnComplete = opts.get("removeOnComplete", True)
        self.removeOnFail = opts.get("removeOnFail", False)
        self.processedOn = 0
        self.finishedOn = 0
        self.returnvalue = None
        self.failedReason = None
        self.repeatJobKey = None
        self.stacktrace: List[str] = []


def fromJSON(client: Redis, rawData: dict, jobId: Optional[str] = None):
    """
    Instantiates a Job from a JobJsonRaw object (coming from a deserialized JSON object)

    @param queue: the queue where the job belongs to.
    @param json: the plain object containing the job.
    @param jobId: an optional job id (overrides the id coming from the JSON object)
    """
    data = json.loads(rawData.get("data", '{}'))
    opts = optsFromJSON(json.loads(rawData.get("opts", '{}')))

    job = Job(client, rawData.get("name"), data, opts)
    job.id = jobId or rawData.get("id", b'').decode("utf-8")

    job.progress = json.loads(rawData.get("progress",  '0'))
    job.delay = int(rawData.get("delay", "0"))
    job.timestamp = int(rawData.get("timestamp", "0"))

    if rawData.get("finishedOn"):
        job.finishedOn = int(rawData.get("finishedOn"))

    if rawData.get("processedOn"):
        job.processedOn = int(rawData.get("processedOn"))

    if rawData.get("rjk"):
        job.repeatJobKey = rawData.get("rjk")

    job.failedReason = rawData.get("failedReason")
    job.attemptsMade = int(rawData.get("attemptsMade", "0"))

    returnvalue = rawData.get("returnvalue")
    if type(returnvalue) == str:
        job.returnvalue = getReturnValue(returnvalue)

    job.stacktrace = json.loads(rawData.get("stacktrace", "[]"))

    # if (json.parentKey) {
    #   job.parentKey = json.parentKey;
    # }

    # if (json.parent) {
    #   job.parent = JSON.parse(json.parent);
    # }

    return job


Job.fromJSON = staticmethod(fromJSON)


def optsFromJSON(rawOpts):
    # opts = json.loads(rawOpts)
    opts = rawOpts

    option_entries = opts.items()

    options = {}
    for item in option_entries:
        attribute_name = item[0]
        value = item[1]
        if attribute_name in optsDecodeMap:
            options[optsDecodeMap[attribute_name]] = value
        else:
            options[attribute_name] = value

    return options


def getReturnValue(value: Any):
    try:
        json.loads(value)
    except Exception as err:
        return value
