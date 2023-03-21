from typing import Any
import json
import time

from redis import Redis
from typing import Dict, List, Union, Any

optsDecodeMap = {
  'fpof': 'failParentOnFailure',
  'kl': 'keepLogs',
}

optsEncodeMap = {v: k for k, v in optsDecodeMap.items()}

class Job:
    """
    Instantiate a Queue object
    """
    def __init__(self, client: Redis, name: str, data: Any, opts = {}):
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

def fromJSON(client: Redis, rawData, jobId = None):
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

    optionEntries = opts.items()

    options = {}
    for item in optionEntries:
        attributeName = item[0]
        value = item[1]
        if attributeName in optsDecodeMap:
            options[optsDecodeMap[attributeName]] = value
        else:
            options[attributeName] = value

    return options

def getReturnValue(value: Any):
    try:
        json.loads(value)
    except Exception as err:
        return value
