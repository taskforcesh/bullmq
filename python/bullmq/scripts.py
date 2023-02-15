"""
    This class is used to load and execute Lua scripts.
    It is a wrapper around the Redis client.
"""
from typing import Any, Dict, List, Union
import time
import json
import msgpack
import os

from redis import Redis

from bullmq.job import Job
from bullmq.error_code import ErrorCode

basePath = os.path.dirname(os.path.realpath(__file__))

class Scripts:

    def __init__(self, prefix: str, queueName: str, redisClient):
        self.prefix = prefix
        self.queueName = queueName
        self.keys = {}
        self.redisClient = redisClient
        self.commands = {
            "addJob": redisClient.register_script(self.getScript("addJob-8.lua")),
            "obliterate": redisClient.register_script(self.getScript("obliterate-2.lua")),
            "pause": redisClient.register_script(self.getScript("pause-4.lua")),
            "moveToActive": redisClient.register_script(self.getScript("moveToActive-9.lua")),
            "moveToFinished": redisClient.register_script(self.getScript("moveToFinished-12.lua")),
            "extendLock": redisClient.register_script(self.getScript("extendLock-2.lua")),
            "moveStalledJobsToWait": redisClient.register_script(self.getScript("moveStalledJobsToWait-8.lua")),
        }

        # loop all the names and add them to the keys object
        names = ["", "active", "wait", "paused", "completed", "failed", "delayed", "stalled", "limiter", "priority", "id", "stalled-check", "meta", "events"]
        for name in names:
            self.keys[name] = self.toKey(name)
    
    def toKey(self, name):
        return self.prefix + ":" + self.queueName + ":" + name

    def getScript(self, name):
        "Get a script by name"
        file = open(basePath + "/commands/" + name, "r")
        data = file.read()
        file.close()
        return data

    def getKeys(self, keys: list):
        def mapKey(key):
            return self.keys[key]
        return list(map(mapKey, keys))

    def addJob(self, job: Job):
        "Add an item to the queue"

        packedArgs = msgpack.packb([self.keys[""], job.id or "", job.name, job.timestamp], use_bin_type=True)
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
        
        keys = self.getKeys(['wait', 'paused', 'meta', 'id', 'delayed', 'priority', 'completed', 'events'])
      
        return self.commands["addJob"](keys=keys, args=[packedArgs, jsonData, packedOpts])
    
    def pause(self, pause: bool = True):
        "Pause or resume a queue"

        src = "wait" if pause else "paused"
        dst = "paused" if pause else "wait"

        keys = self.getKeys([src, dst, 'meta', 'events'])
        return self.commands["pause"](keys, args=["paused" if pause else "resumed"])
    
    async def obliterate(self, count: int, force: bool = False):
        "Remove a queue completely"
        keys = self.getKeys(['meta', ''])
        result = await self.commands["obliterate"](keys, args=[count, force or ""])
        if (result < 0):
            if (result == -1):
                raise Exception("Cannot obliterate non-paused queue")
            if (result == -2):
                raise Exception("Cannot obliterate queue with active jobs")
        return result

    async def moveToActive(self, token: str, opts: dict, jobId: str = "") -> list[Any]:
        "Add an item to the queue"

        timestamp = round(time.time() * 1000)

        lockDuration = opts.get("lockDuration", 0)
        limiter = opts.get("limiter", None)
      
        keys = self.getKeys(['wait', 'active', 'priority', 'events', 'stalled', 'limiter', 'delayed', 'paused', 'meta'])
        packedOpts = msgpack.packb({"token": token, "lockDuration": lockDuration, "limiter": limiter }, use_bin_type=True)
        args = [self.keys[''], timestamp, jobId or "", packedOpts]
      
        result = await self.commands["moveToActive"](keys=keys, args=args)

        # Todo: up to 4 results in tuple (only 2 now)
        return raw2NextJobData(result)


    def moveToCompleted(self, job: Job, val: Any, removeOnComplete, token: str, opts: dict, fetchNext = True):
        return self.moveToFinished(job, val, "returnvalue", removeOnComplete, "completed", token, opts, fetchNext)

    def moveToFailed(self, job: Job, failedReason: str, removeOnFailed, token: str, opts: dict, fetchNext = True):
        return self.moveToFinished(job, failedReason, "failedReason", removeOnFailed, "failed", token, opts, fetchNext)

    async def moveToFinished(self, job: Job, val: Any, propVal: str, shouldRemove, target, token: str, opts: dict, fetchNext = True ) -> list[Any] | None:
        timestamp = round(time.time() * 1000)
        metricsKey = self.toKey('metrics:' + target);

        keys = self.getKeys(['wait', 'active', 'priority', 'events', 'stalled', 'limiter', 'delayed', 'paused', target])
        keys.append(self.toKey(job.id))
        keys.append(self.keys['meta'])
        keys.append(metricsKey)

        def getKeepJobs(shouldRemove):
            if shouldRemove == True:
                return { "count": 0 }
            
            if type(shouldRemove) == int:
                return { "count": shouldRemove }

            if type(shouldRemove) == dict:
                return shouldRemove

            if shouldRemove == False or shouldRemove == None:
                return { "count": -1 }

        def getMetricsSize(opts):
            metrics = opts.get("metrics")
            if metrics != None:
                return metrics.get("maxDataPoints", "")
            return None

        def getFailParentOnFailure(job):
            opts = job.opts
            if opts != None:
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
         
        args = [job.id, timestamp, propVal, val or "", target, "", fetchNext and "fetch" or "" , self.keys[''], packedOpts]
        result = await self.commands["moveToFinished"](keys=keys, args=args)

        if result != None:
            if result < 0:
                raise finishedErrors(result, job.id, 'finished', 'active');
            else:
                # I do not like this as it is using a sideeffect
                job.finishedOn = timestamp
            return raw2NextJobData(result)
        return None

    def extendLock(self, jobId: str, token: str, duration: int, client: Redis = None):
        keys = [self.toKey(jobId) + ":lock", self.keys['stalled']]
        args = [token, duration, jobId]
        return self.commands["extendLock"](keys, args, client)

    def moveStalledJobsToWait(self, maxStalledCount: int, stalledInterval: int):
        keys = self.getKeys(['stalled', 'wait', 'active', 'failed', 'stalled-check', 'meta', 'paused', 'events'])
        args = [maxStalledCount, self.keys[''], round(time.time() * 1000), stalledInterval]
        return self.commands["moveStalledJobsToWait"](keys, args)

def finishedErrors(code: int, jobId: str, command: str, state: str) -> TypeError:
    if code == ErrorCode.JobNotExist.value:
        return TypeError("Missing key for job " + jobId + "." + command)
    elif code == ErrorCode.JobLockNotExist.value:
        return TypeError("Missing lock for job " + jobId + "." + command)
    elif code == ErrorCode.JobNotInState.value:
        return TypeError("Job " + jobId + " is not in the state" + state + "." + command)
    elif code == ErrorCode.JobPendingDependencies.value:
        return TypeError("Job " + jobId + " has pending dependencies. " + command)
    elif code == ErrorCode.ParentJobNotExist.value:
        return TypeError("Missing key for parent job " + jobId + "." + command)
    elif code == ErrorCode.JobLockMismatch.value:
        return TypeError("Lock mismatch for job " + jobId + ". Cmd "+ command + " from " + state)
    else:
        return TypeError("Unknown code " + str(code) + " error for " + jobId + "." + command)

def raw2NextJobData(raw: list[Any]) -> list[Any] | None:
    if raw:
        # TODO: return all the raw datas (up to 4)
        if raw[0]:
            return (array2obj(raw[0]), raw[1])
        else:
            return (None, raw[1])
    return None

def array2obj(arr: [str]) -> {str: str}:
    obj = {}
    for i in range(0, len(arr), 2):
        obj[arr[i]] = arr[i + 1]
    return obj
