"""
    This class is used to load and execute Lua scripts.
    It is a wrapper around the Redis client.
"""

from __future__ import annotations
from redis import Redis
from bullmq.error_code import ErrorCode
from typing import Any, TYPE_CHECKING
if TYPE_CHECKING:
    from bullmq.job import Job

import time
import json
import msgpack
import os


basePath = os.path.dirname(os.path.realpath(__file__))


class Scripts:

    def __init__(self, prefix: str, queueName: str, redisClient: Redis):
        self.prefix = prefix
        self.queueName = queueName
        self.keys = {}
        self.redisClient = redisClient
        self.commands = {
            "addJob": redisClient.register_script(self.getScript("addJob-8.lua")),
            "extendLock": redisClient.register_script(self.getScript("extendLock-2.lua")),
            "getCounts": redisClient.register_script(self.getScript("getCounts-1.lua")),
            "obliterate": redisClient.register_script(self.getScript("obliterate-2.lua")),
            "pause": redisClient.register_script(self.getScript("pause-4.lua")),
            "moveToActive": redisClient.register_script(self.getScript("moveToActive-9.lua")),
            "moveToDelayed": redisClient.register_script(self.getScript("moveToDelayed-8.lua")),
            "moveToFinished": redisClient.register_script(self.getScript("moveToFinished-12.lua")),
            "moveStalledJobsToWait": redisClient.register_script(self.getScript("moveStalledJobsToWait-8.lua")),
            "retryJobs": redisClient.register_script(self.getScript("retryJobs-6.lua")),
            "updateProgress": redisClient.register_script(self.getScript("updateProgress-2.lua")),
        }

        # loop all the names and add them to the keys object
        names = ["", "active", "wait", "paused", "completed", "failed", "delayed",
                 "stalled", "limiter", "priority", "id", "stalled-check", "meta", "events"]
        for name in names:
            self.keys[name] = self.toKey(name)

    def toKey(self, name: str):
        return f"{self.prefix}:{self.queueName}:{name}"

    def getScript(self, name: str):
        """
        Get a script by name
        """
        file = open(f"{basePath}/commands/{name}", "r")
        data = file.read()
        file.close()
        return data

    def getKeys(self, keys: list[str]):
        def mapKey(key):
            return self.keys[key]
        return list(map(mapKey, keys))

    def addJob(self, job: Job):
        """
        Add an item to the queue
        """
        packedArgs = msgpack.packb(
            [self.keys[""], job.id or "", job.name, job.timestamp], use_bin_type=True)
        #  We are still lacking some arguments here:
        #  ARGV[1] msgpacked arguments array
        #         [1]  key prefix,
        #         [2]  custom id (will not generate one automatically)
        #         [3]  name
        #         [4]  timestamp
        #         [5]  parentKey?
        #         [6]  waitChildrenKey key.
        #         [7]  parent dependencies key.
        #         [8]  parent? {id, queueKey}
        #         [9]  repeat job key

        jsonData = json.dumps(job.data, separators=(',', ':'))
        packedOpts = msgpack.packb(job.opts)

        keys = self.getKeys(['wait', 'paused', 'meta', 'id',
                            'delayed', 'priority', 'completed', 'events'])

        return self.commands["addJob"](keys=keys, args=[packedArgs, jsonData, packedOpts])

    def moveToDelayedArgs(self, job_id: str, timestamp: int, token: str):
        max_timestamp = max(0, timestamp or 0)

        if timestamp > 0:
            max_timestamp = max_timestamp * 0x1000 + (convert_to_int(job_id) & 0xfff)
        
        keys = self.getKeys(['wait', 'active', 'priority', 'delayed',
            job_id, 'events', 'paused', 'meta'])
        

        args = [self.keys[''], round(time.time() * 1000), str(max_timestamp),
            job_id, token]
        
        return (keys, args)

    async def moveToDelayed(self, job_id: str, timestamp: int, token: str = "0"):
        keys, args = self.moveToDelayedArgs(job_id, timestamp, token)

        result = await self.commands["moveToDelayed"](keys=keys, args=args)

        if result is not None:
            if result < 0:
                raise finishedErrors(result, job_id, 'moveToDelayed', 'active')
        return None

    def getCounts(self, types):
        keys = self.getKeys([''])
        transformed_types = list(
            map(lambda type: 'wait' if type == 'waiting' else type, types))

        return self.commands["getCounts"](keys=keys, args=transformed_types)

    def pause(self, pause: bool = True):
        """
        Pause or resume a queue
        """
        src = "wait" if pause else "paused"
        dst = "paused" if pause else "wait"
        keys = self.getKeys([src, dst, 'meta', 'events'])
        return self.commands["pause"](keys, args=["paused" if pause else "resumed"])

    async def obliterate(self, count: int, force: bool = False):
        """
        Remove a queue completely
        """
        keys = self.getKeys(['meta', ''])
        result = await self.commands["obliterate"](keys, args=[count, force or ""])
        if (result < 0):
            if (result == -1):
                raise Exception("Cannot obliterate non-paused queue")
            if (result == -2):
                raise Exception("Cannot obliterate queue with active jobs")
        return result

    async def retryJobs(self, state: str, count: int, timestamp: int):
        """
        Remove a queue completely
        """
        current_state = state or 'failed'
        keys = self.getKeys(
            ['', 'events', current_state, 'wait', 'paused', 'meta'])
        result = await self.commands["retryJobs"](keys=keys, args=[count or 1000, timestamp or round(time.time()*1000), current_state])
        return result

    async def moveToActive(self, token: str, opts: dict, jobId: str = "") -> list[Any]:
        """
        Add an item to the queue
        """
        timestamp = round(time.time() * 1000)
        lockDuration = opts.get("lockDuration", 0)
        limiter = opts.get("limiter", None)

        keys = self.getKeys(['wait', 'active', 'priority', 'events',
                            'stalled', 'limiter', 'delayed', 'paused', 'meta'])
        packedOpts = msgpack.packb(
            {"token": token, "lockDuration": lockDuration, "limiter": limiter}, use_bin_type=True)
        args = [self.keys[''], timestamp, jobId or "", packedOpts]

        result = await self.commands["moveToActive"](keys=keys, args=args)

        # Todo: up to 4 results in tuple (only 2 now)
        return raw2NextJobData(result)

    def moveToCompleted(self, job: Job, val: Any, removeOnComplete, token: str, opts: dict, fetchNext=True):
        return self.moveToFinished(job, val, "returnvalue", removeOnComplete, "completed", token, opts, fetchNext)

    def moveToFailed(self, job: Job, failedReason: str, removeOnFailed, token: str, opts: dict, fetchNext=True):
        return self.moveToFinished(job, failedReason, "failedReason", removeOnFailed, "failed", token, opts, fetchNext)

    async def updateProgress(self, job_id: str, progress):
        keys = [self.toKey(job_id), self.keys['events']]
        progress_json = json.dumps(progress, separators=(',', ':'))
        args = [job_id, progress_json]
        result = await self.commands["updateProgress"](keys=keys, args=args)

        if result is not None:
            if result < 0:
                raise finishedErrors(result, job_id, 'updateProgress')
        return None

    def moveToFinishedArgs(self, job: Job, val: Any, propVal: str, shouldRemove, target, token: str, opts: dict, fetchNext=True) -> list[Any] | None:
        timestamp = round(time.time() * 1000)
        metricsKey = self.toKey('metrics:' + target)

        keys = self.getKeys(['wait', 'active', 'priority', 'events',
                            'stalled', 'limiter', 'delayed', 'paused', target])
        keys.append(self.toKey(job.id))
        keys.append(self.keys['meta'])
        keys.append(metricsKey)

        def getKeepJobs(shouldRemove: bool | dict | int | None):
            if type(shouldRemove) == int:
                return {"count": shouldRemove}

            if type(shouldRemove) == dict:
                return shouldRemove

            if shouldRemove:
                return {"count": 0}

            if not shouldRemove or shouldRemove is None:
                return {"count": -1}

        def getMetricsSize(opts: dict):
            metrics = opts.get("metrics")
            if metrics is not None:
                return metrics.get("maxDataPoints", "")
            return ""

        def getFailParentOnFailure(job: Job):
            opts = job.opts
            if opts is not None:
                return opts.get("failParentOnFailure", False)

        keepJobs = getKeepJobs(shouldRemove)

        packedOpts = msgpack.packb({
            "token": token,
            "keepJobs": keepJobs,
            "limiter": opts.get("limiter"),
            "lockDuration": opts.get("lockDuration"),
            "attempts": job.attempts,
            "attemptsMade": job.attemptsMade,
            "maxMetricsSize": getMetricsSize(opts),
            "fpof": getFailParentOnFailure(job),
        }, use_bin_type=True)

        args = [job.id, timestamp, propVal, val or "", target, "",
                fetchNext and "fetch" or "", self.keys[''], packedOpts]
        return (keys, args)

    def moveToFailedArgs(self, job: Job, failed_reason: str, shouldRemove, token: str, opts: dict, fetchNext=True):
        return self.moveToFinishedArgs(
            job, failed_reason, 'failedReason', shouldRemove, 'failed',
            token, opts, fetchNext
        )

    async def moveToFinished(self, job: Job, val: Any, propVal: str, shouldRemove, target, token: str, opts: dict, fetchNext=True) -> list[Any] | None:
        keys, args = self.moveToFinishedArgs(job, val, propVal, shouldRemove, target, token, opts, fetchNext)

        result = await self.commands["moveToFinished"](keys=keys, args=args)

        if result is not None:
            if result < 0:
                raise finishedErrors(result, job.id, 'finished', 'active')
            #else:
                # I do not like this as it is using a sideeffect
                # job.finishedOn = timestamp
            return raw2NextJobData(result)
        return None

    def extendLock(self, jobId: str, token: str, duration: int, client: Redis = None):
        keys = [self.toKey(jobId) + ":lock", self.keys['stalled']]
        args = [token, duration, jobId]
        return self.commands["extendLock"](keys, args, client)

    def moveStalledJobsToWait(self, maxStalledCount: int, stalledInterval: int):
        keys = self.getKeys(['stalled', 'wait', 'active', 'failed',
                            'stalled-check', 'meta', 'paused', 'events'])
        args = [maxStalledCount, self.keys[''], round(
            time.time() * 1000), stalledInterval]
        return self.commands["moveStalledJobsToWait"](keys, args)


def finishedErrors(code: int, jobId: str, command: str, state: str) -> TypeError:
    if code == ErrorCode.JobNotExist.value:
        return TypeError(f"Missing key for job {jobId}.{command}")
    elif code == ErrorCode.JobLockNotExist.value:
        return TypeError(f"Missing lock for job {jobId}.{command}")
    elif code == ErrorCode.JobNotInState.value:
        return TypeError(f"Job {jobId} is not in the state {state}.{command}")
    elif code == ErrorCode.JobPendingDependencies.value:
        return TypeError(f"Job {jobId} has pending dependencies.{command}")
    elif code == ErrorCode.ParentJobNotExist.value:
        return TypeError(f"Missing key for parent job {jobId}.{command}")
    elif code == ErrorCode.JobLockMismatch.value:
        return TypeError(f"Lock mismatch for job {jobId}. Cmd {command} from {state}")
    else:
        return TypeError(f"Unknown code {str(code)} error for {jobId}.{command}")


def raw2NextJobData(raw: list[Any]) -> list[Any] | None:
    if raw:
        # TODO: return all the raw datas (up to 4)
        if raw[0]:
            return (array2obj(raw[0]), raw[1])
        else:
            return (None, raw[1])
    return None


def array2obj(arr: list[str]) -> dict[str, str]:
    obj = {}
    for i in range(0, len(arr), 2):
        obj[arr[i]] = arr[i + 1]
    return obj


def convert_to_int(text: str):
    try:
        result = int(text)
        return result
    except ValueError:
        return 0
