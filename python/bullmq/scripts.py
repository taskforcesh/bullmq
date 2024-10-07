"""
    This class is used to load and execute Lua scripts.
    It is a wrapper around the Redis client.
"""

from __future__ import annotations
from redis import Redis
from bullmq.queue_keys import QueueKeys
from bullmq.error_code import ErrorCode
from bullmq.utils import isRedisVersionLowerThan, get_parent_key
from typing import Any, TYPE_CHECKING
if TYPE_CHECKING:
    from bullmq.job import Job
    from bullmq.redis_connection import RedisConnection

import time
import json
import msgpack
import os


basePath = os.path.dirname(os.path.realpath(__file__))


class Scripts:

    def __init__(self, prefix: str, queueName: str, redisConnection: RedisConnection):
        self.prefix = prefix
        self.queueName = queueName
        self.keys = {}
        self.redisConnection = redisConnection
        self.redisClient = redisConnection.conn
        self.commands = {
            "addStandardJob": self.redisClient.register_script(self.getScript("addStandardJob-8.lua")),
            "addDelayedJob": self.redisClient.register_script(self.getScript("addDelayedJob-6.lua")),
            "addParentJob": self.redisClient.register_script(self.getScript("addParentJob-4.lua")),
            "addPrioritizedJob": self.redisClient.register_script(self.getScript("addPrioritizedJob-8.lua")),
            "changePriority": self.redisClient.register_script(self.getScript("changePriority-7.lua")),
            "cleanJobsInSet": self.redisClient.register_script(self.getScript("cleanJobsInSet-3.lua")),
            "extendLock": self.redisClient.register_script(self.getScript("extendLock-2.lua")),
            "getCounts": self.redisClient.register_script(self.getScript("getCounts-1.lua")),
            "getCountsPerPriority": self.redisClient.register_script(self.getScript("getCountsPerPriority-4.lua")),
            "getRanges": self.redisClient.register_script(self.getScript("getRanges-1.lua")),
            "getState": self.redisClient.register_script(self.getScript("getState-8.lua")),
            "getStateV2": self.redisClient.register_script(self.getScript("getStateV2-8.lua")),
            "isJobInList": self.redisClient.register_script(self.getScript("isJobInList-1.lua")),
            "moveStalledJobsToWait": self.redisClient.register_script(self.getScript("moveStalledJobsToWait-9.lua")),
            "moveToActive": self.redisClient.register_script(self.getScript("moveToActive-11.lua")),
            "moveToDelayed": self.redisClient.register_script(self.getScript("moveToDelayed-8.lua")),
            "moveToFinished": self.redisClient.register_script(self.getScript("moveToFinished-14.lua")),
            "moveToWaitingChildren": self.redisClient.register_script(self.getScript("moveToWaitingChildren-5.lua")),
            "obliterate": self.redisClient.register_script(self.getScript("obliterate-2.lua")),
            "pause": self.redisClient.register_script(self.getScript("pause-7.lua")),
            "promote": self.redisClient.register_script(self.getScript("promote-9.lua")),
            "removeJob": self.redisClient.register_script(self.getScript("removeJob-2.lua")),
            "reprocessJob": self.redisClient.register_script(self.getScript("reprocessJob-8.lua")),
            "retryJob": self.redisClient.register_script(self.getScript("retryJob-11.lua")),
            "moveJobsToWait": self.redisClient.register_script(self.getScript("moveJobsToWait-8.lua")),
            "saveStacktrace": self.redisClient.register_script(self.getScript("saveStacktrace-1.lua")),
            "updateData": self.redisClient.register_script(self.getScript("updateData-1.lua")),
            "updateProgress": self.redisClient.register_script(self.getScript("updateProgress-3.lua")),
        }

        self.queue_keys = QueueKeys(prefix)
        self.keys = self.queue_keys.getKeys(queueName)

    def resetQueueKeys(self, queue_name: str):
        self.queueName = queue_name
        self.keys = self.queue_keys.getKeys(queue_name)

    def toKey(self, name: str):
        return self.queue_keys.toKey(self.queueName, name)

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

    def addJobArgs(self, job: Job, waiting_children_key: str|None):
        #  We are still lacking some arguments here:
        #  ARGV[1] msgpacked arguments array
        #         [9]  repeat job key

        jsonData = json.dumps(job.data, separators=(',', ':'), allow_nan=False)
        packedOpts = msgpack.packb(job.opts)

        parent = job.parent
        parentKey = job.parentKey

        packedArgs = msgpack.packb(
            [self.keys[""], job.id or "", job.name, job.timestamp, job.parentKey,
                waiting_children_key,
                f"{parentKey}:dependencies" if parentKey else None, parent],use_bin_type=True)
        
        return [packedArgs, jsonData, packedOpts]

    def addJob(self, job: Job, pipe = None):
        """
        Add an item to the queue
        """
        if job.opts.get("delay"):
            return self.addDelayedJob(job, job.opts.get("delay"), pipe)
        elif job.opts.get("priority"):
            return self.addPrioritizedJob(job, job.opts.get("priority"), pipe)
        else:
            return self.addStandardJob(job, job.timestamp, pipe)

    def addStandardJob(self, job: Job, timestamp: int, pipe = None):
        """
        Add a standard job to the queue
        """
        keys = self.getKeys(['wait', 'paused', 'meta', 'id',
                             'completed', 'active', 'events', 'marker'])
        args = self.addJobArgs(job, None)
        args.append(timestamp)

        return self.commands["addStandardJob"](keys=keys, args=args, client=pipe)
    
    def addDelayedJob(self, job: Job, timestamp: int, pipe = None):
        """
        Add a delayed job to the queue
        """
        keys = self.getKeys(['marker', 'meta', 'id',
                            'delayed', 'completed', 'events'])
        args = self.addJobArgs(job, None)
        args.append(timestamp)

        return self.commands["addDelayedJob"](keys=keys, args=args, client=pipe)
    
    def addPrioritizedJob(self, job: Job, timestamp: int, pipe = None):
        """
        Add a prioritized job to the queue
        """
        keys = self.getKeys(['marker', 'meta', 'id',
                            'prioritized', 'completed', 'active', 'events', 'pc'])
        args = self.addJobArgs(job, None)
        args.append(timestamp)

        return self.commands["addPrioritizedJob"](keys=keys, args=args, client=pipe)

    def addParentJob(self, job: Job, waiting_children_key: str, pipe = None):
        """
        Add a job to the queue that is a parent
        """
        keys = self.getKeys(['meta', 'id', 'completed', 'events'])
        
        args = self.addJobArgs(job, waiting_children_key)

        return self.commands["addParentJob"](keys=keys, args=args, client=pipe)

    def cleanJobsInSetArgs(self, set: str, grace: int, limit:int = 0):
        keys = [self.toKey(set),
                self.keys['events'],
                self.keys['repeat']]
        args = [self.keys[''], round(time.time() * 1000) - grace, limit, set]

        return (keys, args)

    def cleanJobsInSet(self, set: str, grace: int = 0, limit:int = 0):
        keys, args = self.cleanJobsInSetArgs(set, grace, limit)
        return self.commands["cleanJobsInSet"](keys=keys, args=args)

    def moveToWaitingChildrenArgs(self, job_id, token, opts: dict = {}):
        keys = [self.toKey(job_id) + ":lock",
                self.keys['active'],
                self.keys['waiting-children'],
                self.toKey(job_id),
                self.keys['stalled']]
        child_key = opts.get("child") if opts else None
        args = [token, get_parent_key(child_key) or "", round(time.time() * 1000), job_id,
                "1" if opts.get("skipAttempt") else "0"]

        return (keys, args)

    async def moveToWaitingChildren(self, job_id, token, opts):
        keys, args = self.moveToWaitingChildrenArgs(job_id, token, opts)
        result = await self.commands["moveToWaitingChildren"](keys=keys, args=args)

        if result is not None:
            if result == 1:
                return False
            elif result == 0:
                return True
            elif result < 0:
                raise self.finishedErrors(result, job_id, 'moveToWaitingChildren', 'active')
        return None

    def getRangesArgs(self, types, start: int = 0, end: int = 1, asc: bool = False):
        transformed_types = []
        for type in types:
            transformed_types.append("wait" if type == "waiting" else type)

        keys = self.getKeys([''])
        args = [start, end, "1" if asc else "0"] + transformed_types

        return (keys, args)

    async def getRanges(self, types, start: int = 0, end: int = 1, asc: bool = False):
        commands = []

        switcher = {
            "completed": "zrange",
            "delayed": "zrange",
            "failed": "zrange",
            "priority": "zrange",
            "repeat": "zrange",
            "waiting-children": "zrange",
            "active": "lrange",
            "paused": "lrange",
            "wait": "lrange"
        }
        transformed_types = []
        for type in types:
            transformed_type = "wait" if type == "waiting" else type
            transformed_types.append(transformed_type)
            commands.append(switcher.get(transformed_type))

        keys, args = self.getRangesArgs(transformed_types, start, end, asc)

        responses = await self.commands["getRanges"](keys=keys, args=args)

        results = []
        for i, response in enumerate(responses):
            result = response or []

            if asc and commands[i] == "lrange":
                results+=result.reverse()
            else:
                results+=result

        return results

    def saveStacktraceArgs(self, job_id: str, stacktrace: str, failedReason: str):
        keys = [self.toKey(job_id)]
        args = [stacktrace, failedReason]

        return (keys, args)

    def retryJobArgs(self, job_id: str, lifo: bool, token: str, opts: dict = {}):
        keys = self.getKeys(['active', 'wait', 'paused'])
        keys.append(self.toKey(job_id))
        keys.append(self.keys['meta'])
        keys.append(self.keys['events'])
        keys.append(self.keys['delayed'])
        keys.append(self.keys['prioritized'])
        keys.append(self.keys['pc'])
        keys.append(self.keys['marker'])
        keys.append(self.keys['stalled'])

        push_cmd = "RPUSH" if lifo else "LPUSH"

        args = [self.keys[''], round(time.time() * 1000), push_cmd,
                job_id, token, "1" if opts.get("skipAttempt") else "0"]

        return (keys, args)

    def moveToDelayedArgs(self, job_id: str, timestamp: int, token: str, delay: int = 0, opts: dict = {}):
        keys = self.getKeys(['marker', 'active', 'prioritized', 'delayed'])
        keys.append(self.toKey(job_id))
        keys.append(self.keys['events'])
        keys.append(self.keys['meta'])
        keys.append(self.keys['stalled'])

        args = [self.keys[''], str(timestamp),
                job_id, token, delay, "1" if opts.get("skipAttempt") else "0"]

        return (keys, args)

    async def moveToDelayed(self, job_id: str, timestamp: int, delay: int, token: str = "0"):
        keys, args = self.moveToDelayedArgs(job_id, timestamp, token, delay)

        result = await self.commands["moveToDelayed"](keys=keys, args=args)

        if result is not None:
            if result < 0:
                raise self.finishedErrors(result, job_id, 'moveToDelayed', 'active')
        return None

    def promoteArgs(self, job_id: str):
        keys = self.getKeys(['delayed', 'wait', 'paused', 'meta', 'prioritized', 'active', 'pc', 'events', 'marker'])
        keys.append(self.toKey(job_id))
        keys.append(self.keys['events'])
        keys.append(self.keys['paused'])
        keys.append(self.keys['meta'])

        args = [self.keys[''], job_id]

        return (keys, args)

    async def promote(self, job_id: str):
        keys, args = self.promoteArgs(job_id)

        result = await self.commands["promote"](keys=keys, args=args)

        if result is not None:
            if result < 0:
                raise self.finishedErrors(result, job_id, 'promote', 'delayed')
        return None

    def remove(self, job_id: str, remove_children: bool):
        keys = self.getKeys(['', 'meta'])
        args = [job_id, 1 if remove_children else 0]

        return self.commands["removeJob"](keys=keys, args=args)

    def getCounts(self, types):
        keys = self.getKeys([''])
        transformed_types = list(
            map(lambda type: 'wait' if type == 'waiting' else type, types))

        return self.commands["getCounts"](keys=keys, args=transformed_types)

    def getCountsPerPriorityArgs(self, priorities):
        keys = [self.keys['wait'],
                self.keys['paused'],
                self.keys['meta'],
                self.keys['prioritized']]

        args = priorities

        return (keys, args)

    def getCountsPerPriority(self, priorities):
        keys, args = self.getCountsPerPriorityArgs(priorities)

        return self.commands["getCountsPerPriority"](keys=keys, args=args)

    async def getState(self, job_id: str):
        keys = self.getKeys(['completed', 'failed', 'delayed', 'active', 'wait',
                'paused', 'waiting-children', 'prioritized'])

        args = [job_id, self.toKey(job_id)]

        redis_version = await self.redisConnection.getRedisVersion()

        if isRedisVersionLowerThan(redis_version, '6.0.6'):
            result = await self.commands["getState"](keys=keys, args=args)
            return result

        result = await self.commands["getStateV2"](keys=keys, args=args)
        return result

    async def isJobInList(self, list_key: str, job_id: str):
        redis_version = await self.redisConnection.getRedisVersion()

        result = None
        if isRedisVersionLowerThan(redis_version, '6.0.6'):
            result = await self.commands["getState"](keys=[list_key], args=[job_id])
        else:
            result = await self.redisClient.lpos(list_key, job_id)
        return isinstance(result, int)

    async def changePriority(self, job_id: str, priority:int = 0, lifo:bool = False):
        keys = [self.keys['wait'],
            self.keys['paused'],
            self.keys['meta'],
            self.keys['prioritized'],
            self.keys['active'],
            self.keys['pc'],
            self.keys['marker']]

        args = [priority, self.toKey(job_id), job_id, 1 if lifo else 0]

        result = await self.commands["changePriority"](keys=keys, args=args)

        if result is not None:
            if result < 0:
                raise self.finishedErrors(result, job_id, 'changePriority', None)
        return None

    async def updateData(self, job_id: str, data):
        keys = [self.toKey(job_id)]
        data_json = json.dumps(data, separators=(',', ':'), allow_nan=False)
        args = [data_json]

        result = await self.commands["updateData"](keys=keys, args=args)

        if result is not None:
            if result < 0:
                raise self.finishedErrors(result, job_id, 'updateData', None)
        return None

    async def reprocessJob(self, job: Job, state: str):
        keys = [self.toKey(job.id)]
        keys.append(self.keys['events'])
        keys.append(self.keys[state])
        keys.append(self.keys['wait'])
        keys.append(self.keys['meta'])
        keys.append(self.keys['paused'])
        keys.append(self.keys['active'])
        keys.append(self.keys['marker'])

        args = [
            job.id,
            ("R" if job.opts.get("lifo") else "L") + "PUSH",
            "failedReason" if state == "failed" else "returnvalue",
            state
            ]

        result = await self.commands["reprocessJob"](keys=keys, args=args)

        if result is not None:
            if result < 0:
                raise self.finishedErrors(result, job.id, 'reprocessJob', state)
        return None

    def pause(self, pause: bool = True):
        """
        Pause or resume a queue
        """
        src = "wait" if pause else "paused"
        dst = "paused" if pause else "wait"
        keys = self.getKeys([src, dst, 'meta', 'prioritized', 'events', 'delayed', 'marker'])
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

    def moveJobsToWaitArgs(self, state: str, count: int, timestamp: int) -> int:
        keys = self.getKeys(
            ['', 'events', state, 'wait', 'paused', 'meta', 'active', 'marker'])

        args = [count or 1000, timestamp or round(time.time()*1000), state]
        return (keys, args)

    async def retryJobs(self, state: str, count: int, timestamp: int):
        """
        Retry jobs that are in failed or completed state
        """
        current_state = state or 'failed'
        keys, args = self.moveJobsToWaitArgs(current_state, count, timestamp)

        result = await self.commands["moveJobsToWait"](keys=keys, args=args)
        return result

    async def promoteJobs(self, count: int):
        """
        Promote jobs in delayed state
        """
        keys, args = self.moveJobsToWaitArgs('delayed', count, 1.7976931348623157e+308)

        result = await self.commands["moveJobsToWait"](keys=keys, args=args)
        return result

    async def moveToActive(self, token: str, opts: dict) -> list[Any]:
        """
        Add an item to the queue
        """
        timestamp = round(time.time() * 1000)
        lockDuration = opts.get("lockDuration", 0)
        limiter = opts.get("limiter", None)

        keys = self.getKeys(['wait', 'active', 'prioritized', 'events',
                            'stalled', 'limiter', 'delayed', 'paused', 'meta', 'pc', 'marker'])
        packedOpts = msgpack.packb(
            {"token": token, "lockDuration": lockDuration, "limiter": limiter}, use_bin_type=True)
        args = [self.keys[''], timestamp, packedOpts]

        result = await self.commands["moveToActive"](keys=keys, args=args)

        return raw2NextJobData(result)

    def moveToCompleted(self, job: Job, val: Any, removeOnComplete, token: str, opts: dict, fetchNext=True):
        return self.moveToFinished(job, val, "returnvalue", removeOnComplete, "completed", token, opts, fetchNext)

    def moveToFailed(self, job: Job, failedReason: str, removeOnFailed, token: str, opts: dict, fetchNext=True):
        return self.moveToFinished(job, failedReason, "failedReason", removeOnFailed, "failed", token, opts, fetchNext)

    async def updateProgress(self, job_id: str, progress):
        keys = [self.toKey(job_id), self.keys['events'], self.keys['meta']]
        progress_json = json.dumps(progress, separators=(',', ':'), allow_nan=False)
        args = [job_id, progress_json]
        result = await self.commands["updateProgress"](keys=keys, args=args)

        if result is not None:
            if result < 0:
                raise self.finishedErrors(result, job_id, 'updateProgress', None)
        return None

    def moveToFinishedArgs(self, job: Job, val: Any, propVal: str, shouldRemove, target, token: str,
                           opts: dict, fetchNext=True) -> list[Any] | None:
        transformed_value = json.dumps(val, separators=(',', ':'), allow_nan=False)
        timestamp = round(time.time() * 1000)
        metricsKey = self.toKey('metrics:' + target)

        keys = self.getKeys(['wait', 'active', 'prioritized', 'events',
                            'stalled', 'limiter', 'delayed', 'paused', 'meta', 'pc', target])
        keys.append(self.toKey(job.id))
        keys.append(metricsKey)
        keys.append(self.keys['marker'])

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

        keepJobs = getKeepJobs(shouldRemove)

        packedOpts = msgpack.packb({
            "token": token,
            "keepJobs": keepJobs,
            "limiter": opts.get("limiter"),
            "lockDuration": opts.get("lockDuration"),
            "attempts": job.attempts,
            "attemptsMade": job.attemptsMade,
            "maxMetricsSize": getMetricsSize(opts),
            "fpof": opts.get("failParentOnFailure", False),
            "idof": opts.get("ignoreDependencyOnFailure", False)
        }, use_bin_type=True)

        args = [job.id, timestamp, propVal, transformed_value or "", target,
                fetchNext and "1" or "", self.keys[''], packedOpts]
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
            if type(result) == int and result < 0:
                raise self.finishedErrors(result, job.id, 'finished', 'active')
            return raw2NextJobData(result)
        return None

    def extendLock(self, jobId: str, token: str, duration: int, client: Redis = None):
        keys = [self.toKey(jobId) + ":lock", self.keys['stalled']]
        args = [token, duration, jobId]
        return self.commands["extendLock"](keys, args, client)

    def moveStalledJobsToWait(self, maxStalledCount: int, stalledInterval: int):
        keys = self.getKeys(['stalled', 'wait', 'active', 'failed',
                            'stalled-check', 'meta', 'paused', 'marker', 'events'])
        args = [maxStalledCount, self.keys[''], round(
            time.time() * 1000), stalledInterval]
        return self.commands["moveStalledJobsToWait"](keys, args)

    def finishedErrors(self, code: int, jobId: str, command: str, state: str) -> TypeError:
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
        elif code == ErrorCode.ParentJobCannotBeReplaced.value:
            return TypeError(f"The parent job {jobId} cannot be replaced. {command}")
        else:
            return TypeError(f"Unknown code {str(code)} error for {jobId}.{command}")


def raw2NextJobData(raw: list[Any]) -> list[Any] | None:
    if raw:
        result = [None, raw[1], None, None] if len(raw) == 2 else [None, raw[1], raw[2], raw[3]]
        if raw[0]:
            result[0]= array2obj(raw[0])
        return result
    return [None, None, None, None]


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
