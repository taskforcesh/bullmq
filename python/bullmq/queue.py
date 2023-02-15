import redis.asyncio as redis

from bullmq.scripts import Scripts
from bullmq.job import Job
from bullmq.redis_connection import RedisConnection

class Queue:
    """
        Instantiate a Queue object
    """
    def __init__(self, name: str, redisOpts={}, opts={}):
        """ "Initialize a connection" """

        self.name = name
        self.redisConnection = RedisConnection(redisOpts)
        self.client = self.redisConnection.conn
        self.opts = opts

        self.prefix = opts.get("prefix") or "bull"
        
        self.scripts = Scripts(self.prefix, name, self.redisConnection.conn)

    """
        Add an item to the queue.

        @param name: The name of the queue
        @param data: The data to add to the queue (must be JSON serializable)
    """
    async def add(self, name: str, data, opts = {}):
        """ Add an item to the queue """
        job = Job(self.client, name, data, opts)
        jobId = await self.scripts.addJob(job)
        job.id = jobId
        return job
    
    """
        Pauses the processing of this queue globally
    """
    def pause(self):
        return self.scripts.pause(True)

    def resume(self):
        return self.scripts.pause(False)

    async def isPaused(self):
        pausedKeyExists = await self.conn.hexists(self.opts.get("prefix") or "bull" + ":" + self.name + ":meta", "paused")
        return pausedKeyExists == 1

    """
        Remove everything from the queue.
    """
    async def obliterate(self, force: bool = False):
        """ "Obliterate the queue" """
        await self.pause()
        while True:
            cursor = await self.scripts.obliterate(1000, force)
            if cursor == 0 or cursor == None or cursor == "0":
                break

    """
        Closes the queue and the underlying connection to Redis.
    """
    def close(self):
        """ "Close the connection" """
        return self.redisConnection.close()

async def fromId(queue: Queue, jobId: str):
    key = queue.prefix + ":" + queue.name + ":" + jobId
    rawData = await queue.client.hgetall(key)
    return Job.fromJSON(queue.client, rawData, jobId)

Job.fromId = staticmethod(fromId)
