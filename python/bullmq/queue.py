import redis.asyncio as redis
from typing import TypedDict

from bullmq.scripts import Scripts
from bullmq.job import Job
from bullmq.redis_connection import RedisConnection


class RetryJobsOpts(TypedDict):
    state: str
    count: int
    timestamp: int


class Queue:
    """
    Instantiate a Queue object
    """

    def __init__(self, name: str, redisOpts: dict = {}, opts: dict = {}):
        """ 
        Initialize a connection 
        """
        self.name = name
        self.redisConnection = RedisConnection(redisOpts)
        self.client = self.redisConnection.conn
        self.opts = opts
        self.prefix = opts.get("prefix") or "bull"
        self.scripts = Scripts(self.prefix, name, self.redisConnection.conn)

    async def add(self, name: str, data, opts: dict = {}):
        """
        Adds a new job to the queue.

        @param name: Name of the job to be added to the queue,.
        @param data: Arbitrary data to append to the job.
        @param opts: Job options that affects how the job is going to be processed.
        """
        job = Job(self.client, name, data, opts)
        jobId = await self.scripts.addJob(job)
        job.id = jobId
        return job

    def pause(self):
        """
        Pauses the processing of this queue globally.

        We use an atomic RENAME operation on the wait queue. Since
        we have blocking calls with BRPOPLPUSH on the wait queue, as long as the queue
        is renamed to 'paused', no new jobs will be processed (the current ones
        will run until finalized).

        Adding jobs requires a LUA script to check first if the paused list exist
        and in that case it will add it there instead of the wait list.
        """
        return self.scripts.pause(True)

    def resume(self):
        """
        Resumes the processing of this queue globally.

        The method reverses the pause operation by resuming the processing of the
        queue.
        """
        return self.scripts.pause(False)

    async def isPaused(self):
        """ 
        Returns true if the queue is currently paused. 
        """
        pausedKeyExists = await self.client.hexists(self.opts.get("prefix") or f"bull:{self.name}:meta", "paused")
        return pausedKeyExists == 1

    async def obliterate(self, force: bool = False):
        """
        Completely destroys the queue and all of its contents irreversibly.
        This method will the *pause* the queue and requires that there are no
        active jobs. It is possible to bypass this requirement, i.e. not
        having active jobs using the "force" option.

        Note: This operation requires to iterate on all the jobs stored in the queue
        and can be slow for very large queues.

        @param opts: Obliterate options.
        """
        await self.pause()
        while True:
            cursor = await self.scripts.obliterate(1000, force)
            if cursor == 0 or cursor == None or cursor == "0":
                break

    async def retryJobs(self, opts: RetryJobsOpts = {}):
        """
        Retry all the failed jobs.
        """
        while True:
            cursor = await self.scripts.retryJobs(
                opts.get("state"),
                opts.get("count"),
                opts.get("timestamp")
            )
            if cursor == 0 or cursor == None or cursor == "0":
                break

    def trimEvents(self, maxLength: int):
        """
        Trim the event stream to an approximately maxLength.

        @param maxLength:
        """
        return self.client.xtrim(self.opts.get("prefix") or f"bull:{self.name}:events", "MAXLEN", "~", maxLength)

    def close(self):
        """
        Close the queue instance.
        """
        return self.redisConnection.close()


async def fromId(queue: Queue, jobId: str):
    key = f"{queue.prefix}:{queue.name}:{jobId}"
    rawData = await queue.client.hgetall(key)
    return Job.fromJSON(queue.client, rawData, jobId)

Job.fromId = staticmethod(fromId)
