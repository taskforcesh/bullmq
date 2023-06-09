from __future__ import annotations
from typing import List, Any, TYPE_CHECKING
from bullmq.scripts import Scripts
from bullmq.backoffs import Backoffs
if TYPE_CHECKING:
    from bullmq.queue import Queue
from bullmq.types import JobOptions

import json
import time
import traceback


optsDecodeMap = {
    'fpof': 'failParentOnFailure',
    'kl': 'keepLogs',
}

optsEncodeMap = {v: k for k, v in optsDecodeMap.items()}


class Job:
    """
    This class represents a Job in the queue. Normally job are implicitly created when
    you add a job to the queue with methods such as Queue.addJob( ... )

    A Job instance is also passed to the Worker's process function.
    """

    def __init__(self, queue: Queue, name: str, data: Any, opts: JobOptions = {}):
        self.name = name
        self.id = opts.get("jobId", None)
        self.progress = 0
        self.timestamp = opts.get("timestamp", round(time.time() * 1000))
        final_opts = {"attempts": 0, "delay": 0}
        final_opts.update(opts or {})
        self.discarded = False
        self.opts = final_opts
        self.queue = queue
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
        self.scripts = Scripts(queue.prefix, queue.name, queue.redisConnection)

    def updateData(self, data):
        self.data = data
        return self.scripts.updateData(self.id, data)

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

    async def remove(self):
        removed = await self.scripts.remove(self.id)
        
        if not removed:
            raise Exception(f"Could not remove job {self.id}")

    async def moveToFailed(self, err, token:str, fetchNext:bool = False):
        error_message = str(err)
        self.failedReason = error_message

        move_to_failed = False
        finished_on = 0
        command = 'moveToFailed'

        async with self.queue.redisConnection.conn.pipeline(transaction=True) as pipe:
            await self.saveStacktrace(pipe, error_message)
            if self.attemptsMade < self.opts['attempts'] and not self.discarded:
                delay = await Backoffs.calculate(
                    self.opts.get('backoff'), self.attemptsMade,
                    err, self, self.queue.opts.get("settings") and self.queue.opts['settings'].get("backoffStrategy")
                    )
                if delay == -1:
                    move_to_failed = True
                elif delay:
                    keys, args = self.scripts.moveToDelayedArgs(
                        self.id,
                        round(time.time() * 1000) + delay,
                        token
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

    async def saveStacktrace(self, pipe, err:str):
        stacktrace = traceback.format_exc()
        stackTraceLimit = self.opts.get("stackTraceLimit")

        if stacktrace:
            self.stacktrace.append(stacktrace)
            if self.opts.get("stackTraceLimit"):
                self.stacktrace = self.stacktrace[-(stackTraceLimit-1):stackTraceLimit]

        keys, args = self.scripts.saveStacktraceArgs(
            self.id, json.dumps(self.stacktrace, separators=(',', ':')), err)

        await self.scripts.commands["saveStacktrace"](keys=keys, args=args, client=pipe)


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

    @staticmethod
    async def fromId(queue: Queue, jobId: str):
        key = f"{queue.prefix}:{queue.name}:{jobId}"
        raw_data = await queue.client.hgetall(key)
        return Job.fromJSON(queue, raw_data, jobId)


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
        json.loads(value)
    except Exception as err:
        return value
