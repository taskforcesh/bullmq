from __future__ import annotations
from typing import List, Any, TYPE_CHECKING
from bullmq.scripts import Scripts
from bullmq.backoffs import Backoffs
if TYPE_CHECKING:
    from bullmq.queue import Queue
from bullmq.types import JobOptions
from bullmq.utils import get_parent_key, parse_json_string_values

import json
import time
import traceback


optsDecodeMap = {
    'fpof': 'failParentOnFailure',
    'idof': 'ignoreDependencyOnFailure',
    'kl': 'keepLogs',
}

optsEncodeMap = {v: k for k, v in optsDecodeMap.items()}


class Job:
    """
    This class represents a Job in the queue. Normally job are implicitly created when
    you add a job to the queue with methods such as Queue.addJob( ... )

    A Job instance is also passed to the Worker's process function.
    """

    def __init__(self, queue: Queue, name: str, data: Any, opts: JobOptions = {}, job_id: str = None):
        self.name = name
        self.id = opts.get("jobId", None) or job_id
        self.progress = 0
        self.timestamp = opts.get("timestamp", round(time.time() * 1000))
        final_opts = {"attempts": 0, "delay": 0}
        final_opts.update(opts or {})
        final_opts.update({"backoff": Backoffs.normalize(opts.get('backoff'))})
        self.discarded = False
        self.opts = final_opts
        self.queue = queue
        self.delay = opts.get("delay", 0)
        self.attempts = opts.get("attempts", 1)
        self.attemptsMade = 0
        self.attemptsStarted = 0
        self.data = data
        self.removeOnComplete = opts.get("removeOnComplete", True)
        self.removeOnFail = opts.get("removeOnFail", False)
        self.processedOn = 0
        self.finishedOn = 0
        self.returnvalue = None
        self.failedReason = None
        self.repeatJobKey = None
        self.token: str = None
        parent = opts.get("parent")
        self.parentKey = get_parent_key(parent)
        self.parent = {"id": parent.get("id"), "queueKey": parent.get("queue")} if parent else None
        self.stacktrace: List[str] = []
        self.scripts = Scripts(queue.prefix, queue.name, queue.redisConnection)
        self.queueQualifiedName = queue.qualifiedName

    def updateData(self, data):
        self.data = data
        return self.scripts.updateData(self.id, data)

    async def promote(self):
        await self.scripts.promote(self.id)
        self.delay = 0

    def retry(self, state: str = "failed"):
        self.failedReason = None
        self.finishedOn = None
        self.processedOn = None
        self.returnvalue = None
        return self.scripts.reprocessJob(self, state)

    def getState(self):
        return self.scripts.getState(self.id)

    def changePriority(self, opts: dict):
        return self.scripts.changePriority(self.id, opts.get("priority", 0), opts.get("lifo", False))

    def updateProgress(self, progress):
        self.progress = progress
        return self.scripts.updateProgress(self.id, progress)

    async def remove(self, opts: dict = {}):
        removed = await self.scripts.remove(self.id, opts.get("removeChildren", True))

        if not removed:
            raise Exception(f"Job {self.id} could not be removed because it is locked by another worker")

    def isCompleted(self):
        """
        Returns true if the job has completed.
        """
        return self.isInZSet('completed')

    def isFailed(self):
        """
        Returns true if the job has failed.
        """
        return self.isInZSet('failed')

    def isDelayed(self):
        """
        Returns true if the job is delayed.
        """
        return self.isInZSet('delayed')

    def isWaitingChildren(self):
        """
        Returns true if the job is waiting for children.
        """
        return self.isInZSet('waiting-children')

    def isActive(self):
        """
        Returns true if the job is active.
        """
        return self.isInList('active')

    async def isWaiting(self):
        return ( await self.isInList('wait') or await self.isInList('paused'))

    async def isInZSet(self, set: str):
        score = await self.queue.client.zscore(self.scripts.toKey(set), self.id)

        return score is not None

    def isInList(self, list_name: str):
        return self.scripts.isJobInList(self.scripts.toKey(list_name), self.id)

    async def moveToFailed(self, err, token:str, fetchNext:bool = False):
        error_message = str(err)
        self.failedReason = error_message

        move_to_failed = False
        finished_on = 0
        delay = 0
        command = 'moveToFailed'

        async with self.queue.redisConnection.conn.pipeline(transaction=True) as pipe:
            await self.saveStacktrace(pipe, error_message)
            if (self.attemptsMade + 1) < self.opts.get('attempts') and not self.discarded:
                delay = await Backoffs.calculate(
                    self.opts.get('backoff'), self.attemptsMade + 1,
                    err, self, self.queue.opts.get("settings") and self.queue.opts['settings'].get("backoffStrategy")
                    )
                if delay == -1:
                    move_to_failed = True
                elif delay:
                    keys, args = self.scripts.moveToDelayedArgs(
                        self.id,
                        round(time.time() * 1000),
                        token,
                        delay
                    )

                    await self.scripts.commands["moveToDelayed"](keys=keys, args=args, client=pipe)
                    command = 'delayed'
                else:
                    keys, args = self.scripts.retryJobArgs(self.id, self.opts.get("lifo", False), token)

                    await self.scripts.commands["retryJob"](keys=keys, args=args, client=pipe)
                    command = 'retryJob'
            else:
                move_to_failed = True

            if move_to_failed:
                keys, args = self.scripts.moveToFailedArgs(
                    self, error_message, self.opts.get("removeOnFail", False),
                    token, self.opts, fetchNext
                )
                await self.scripts.commands["moveToFinished"](keys=keys, args=args, client=pipe)
                finished_on = args[1]

            results = await pipe.execute()
            code = results[1]

            if code < 0:
                raise self.scripts.finishedErrors(code, self.id, command, 'active')

        if finished_on and type(finished_on) == int:
            self.finishedOn = finished_on

        if delay and type(delay) == int:
            self.delay = delay

        self.attemptsMade = self.attemptsMade + 1

    def log(self, logRow: str):
        return Job.addJobLog(self.queue, self.id, logRow, self.opts.get("keepLogs", 0))

    async def saveStacktrace(self, pipe, err:str):
        stacktrace = traceback.format_exc()
        stackTraceLimit = self.opts.get("stackTraceLimit")

        if stacktrace:
            self.stacktrace.append(stacktrace)
            if self.opts.get("stackTraceLimit"):
                self.stacktrace = self.stacktrace[-(stackTraceLimit-1):stackTraceLimit]

        keys, args = self.scripts.saveStacktraceArgs(
            self.id, json.dumps(self.stacktrace, separators=(',', ':'), allow_nan=False), err)

        await self.scripts.commands["saveStacktrace"](keys=keys, args=args, client=pipe)

    def moveToWaitingChildren(self, token, opts:dict):
        return self.scripts.moveToWaitingChildren(self.id, token, opts)

    async def getChildrenValues(self):
        results = await self.queue.client.hgetall(f"{self.queue.prefix}:{self.queue.name}:{self.id}:processed")
        return parse_json_string_values(results)

    @staticmethod
    def fromJSON(queue: Queue, rawData: dict, jobId: str | None = None):
        """
        Instantiates a Job from a JobJsonRaw object (coming from a deserialized JSON object)

        @param queue: the queue where the job belongs to.
        @param json: the plain object containing the job.
        @param jobId: an optional job id (overrides the id coming from the JSON object)
        """
        data = json.loads(rawData.get("data", '{}'))
        opts = optsFromJSON(json.loads(rawData.get("opts", '{}')))

        job = Job(queue, rawData.get("name"), data, opts)
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

        if rawData.get("ats"):
            job.attemptsStarted = int(rawData.get("ats"))

        job.failedReason = rawData.get("failedReason")
        job.attemptsMade = int(rawData.get("attemptsMade") or rawData.get("atm") or "0")

        returnvalue = rawData.get("returnvalue")
        if type(returnvalue) == str:
            job.returnvalue = getReturnValue(returnvalue)

        job.stacktrace = json.loads(rawData.get("stacktrace", "[]"))

        if rawData.get("parentKey"):
            job.parentKey = rawData.get("parentKey")

        if rawData.get("parent"):
            job.parent = json.loads(rawData.get("parent"))

        return job

    @staticmethod
    async def fromId(queue: Queue, jobId: str):
        key = f"{queue.prefix}:{queue.name}:{jobId}"
        raw_data = await queue.client.hgetall(key)
        if len(raw_data):
            return Job.fromJSON(queue, raw_data, jobId)

    @staticmethod
    async def addJobLog(queue: Queue, jobId: str, logRow: str, keepLogs: int = 0):
        logs_key = f"{queue.prefix}:{queue.name}:{jobId}:logs"
        multi = await queue.client.pipeline()

        multi.rpush(logs_key, logRow)

        if keepLogs:
            multi.ltrim(logs_key, -keepLogs, -1)

        result = await multi.execute()

        return min(keepLogs, result[0]) if keepLogs else result[0]

def optsFromJSON(rawOpts: dict) -> dict:
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
        return json.loads(value)
    except Exception as err:
        return value
