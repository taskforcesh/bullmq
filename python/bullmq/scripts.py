"""
    This class is used to load and execute Lua scripts.
    It is a wrapper around the Redis client.
"""
import time
import json
import msgpack
import os

basePath = os.path.dirname(os.path.realpath(__file__))

class Scripts:

    def __init__(self, prefix: str, queueName: str, redisClient):
        self.keys = {}
        self.redisClient = redisClient
        self.commands = {
            "addJob": redisClient.register_script(self.getScript("addJob-8.lua")),
            "obliterate": redisClient.register_script(self.getScript("obliterate-2.lua")),
            "pause": redisClient.register_script(self.getScript("pause-4.lua")),
        }

        # loop all the names and add them to the keys object
        names = ["", "active", "wait", "paused", "completed", "failed", "delayed", "priority", "id", "stalled-check", "meta", "events"]
        for name in names:
            self.keys[name] = self.toKey(prefix, queueName, name)

    def toKey(self, prefix, queueName, name):
        return prefix + ":" + queueName + ":" + name

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

    async def addJob(self, name: str, data, opts):
        "Add an item to the queue"

        ts = round(time.time() * 1000)

        packedArgs = msgpack.packb([self.keys[""], opts.get("jobId") or "", name, ts], use_bin_type=True)
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

        #   ARGV[2] Json stringified job data
        #   ARGV[3] msgpacked options
        jsonData = json.dumps(data, separators=(',', ':'))
        packedOpts = msgpack.packb(opts)

        keys = self.getKeys(['wait', 'paused', 'meta', 'id', 'delayed', 'priority', 'completed', 'events'])

        jobId = await self.commands["addJob"](keys=keys, args=[packedArgs, jsonData, packedOpts])
        return {"jobId": jobId }

    def pause(self, pause: bool = True):
        "Pause or resume a queue"

        src = "wait" if pause else "paused"
        dst = "paused" if pause else "wait"

        keys = self.getKeys([src, dst, 'meta', 'events'])
        return self.commands["pause"](keys, args=["paused" if pause else "resumed"])

    async def obliterate(self, count: int = None, force: bool = None):
        "Remove a queue completely"
        keys = self.getKeys(['meta', ''])
        result = await self.commands["obliterate"](keys, args=[count, force or ""])
        if (result < 0):
            if (result == -1):
                raise Exception("Cannot obliterate non-paused queue")
            if (result == -2):
                raise Exception("Cannot obliterate queue with active jobs")
        return result
