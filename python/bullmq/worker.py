from typing import Callable
from uuid import uuid4
import asyncio
import traceback
import json

from redis import Redis

from bullmq.scripts import Scripts
from bullmq.redis_connection import RedisConnection
from bullmq.event_emitter import EventEmitter
from bullmq.job import Job
from bullmq.timer import Timer

class Worker(EventEmitter):
    def __init__(self, name: str, processor: Callable[[Job, str], asyncio.Future], opts = {}):
        super().__init__()  
        self.name = name
        self.processor = processor
        self.opts = {
            "concurrency": opts.get("concurrency", 1),
            "lockDuration": opts.get("lockDuration", 30000),
            "maxStalledCount": opts.get("maxStalledCount", 1),
            "stalledInterval": opts.get("stalledInterval", 30000),
        }

        redisOpts = opts.get("connection") or {}

        self.redisConnection = RedisConnection(redisOpts)
        self.client = self.redisConnection.conn

        self.blockingRedisConnection = RedisConnection(redisOpts)
        self.bclient = self.blockingRedisConnection.conn
    
        self.scripts = Scripts(opts.get("prefix") or "bull", name, self.client)

        self.closing = False
        self.forceClosing = False
        self.closed = False
        self.running = False
        self.processing = set()
        self.jobs = set()

        if opts.get("autorun", True):
            asyncio.ensure_future(self.run())

    async def run(self):
        if self.running:
            raise Exception("Worker is already running")

        self.timer = Timer((self.opts.get("lockDuration") / 2) / 1000, self.extendLocks)
        self.stalledCheckTimer = Timer(self.opts.get("stalledInterval") / 1000, self.runStalledJobsCheck)
        self.running = True
        job = None

        token = uuid4().hex
        while not self.closed:
            if not job and len(self.processing) < self.opts.get("concurrency") and not self.closing:
                waitingJob = asyncio.ensure_future(self.getNextJob(token))
                self.processing.add(waitingJob)

            if job:
                processingJob = asyncio.ensure_future(self.processJob(job, token))
                self.processing.add(processingJob)

            try:
                job, pending = await getFirstCompleted(self.processing)
                self.processing = pending

                if job == None or len(self.processing) == 0 and self.closing:
                    # We are done processing so we can close the queue
                    break

            except Exception as e:
                # This should never happen or we will have an endless loop
                print("ERROR:", e)
                traceback.print_exc()
                return

        self.running = False
        self.timer.stop()
        self.stalledCheckTimer.stop()

    async def getNextJob(self, token: str):
        # First try to move a job from the waiting list to the active list
        result = await self.scripts.moveToActive(token, self.opts)
        job = None
        jobId = None
        delayUntil = None
        if result:
            job, jobId = result

        # If there are no jobs in the waiting list we keep waiting with BRPOPLPUSH
        if job == None:
            timeout = min(dalayUntil - int(time.time() * 1000) if delayUntil else 5000, 5000) / 1000
            jobId = await self.bclient.brpoplpush(self.scripts.keys["wait"], self.scripts.keys["active"], timeout)
            if jobId:
                job, jobId = await self.scripts.moveToActive(token, self.opts, jobId)

        if job and jobId:
            return Job.fromJSON(self.client, job, jobId)

    async def processJob(self, job: Job, token: str):
        try:
            self.jobs.add((job, token))
            result = await self.processor(job, token)
            if not self.forceClosing:
                await self.scripts.moveToCompleted(job, result, job.opts.get("removeOnComplete", True), token, self.opts, fetchNext=not self.closing)
            self.emit("completed", job, result)
        except Exception as err:
            try:
                print("Error processing job", err)
                stacktrace = traceback.format_exc()

                if not self.forceClosing:
                    await self.scripts.moveToFailed(job, str(err), job.opts.get("removeOnFail", False), token, self.opts, fetchNext=not self.closing)

                # TODO: Store the stacktrace in the job
                
                self.emit("failed", job, err)
            except Exception as err:
                print("Error moving job to failed", err)
                self.emit("error", err, job)
        finally:
            self.jobs.remove((job, token))

    async def extendLocks(self):
        # Renew all the locks for the jobs that are still active
        try:
            multi = self.client.pipeline()
            for job, token in self.jobs:
                await self.scripts.extendLock(job.id, token, self.opts.get("lockDuration"), multi)
            result = await multi.execute()

            # result includes an object with locks that may not have been renewed.
            # We should emit an error for each of those jobs.
            #    for jobId, err in result.items():
            #    self.emit("error", "could not renew lock for job " + jobId)
            
        except Exception as e:
            print("Error renewing locks", e)
            traceback.print_exc()

    async def runStalledJobsCheck(self):
        try:
            failed, stalled = await self.scripts.moveStalledJobsToWait(self.opts.get("maxStalledCount"), self.opts.get("stalledInterval"))
            for jobId in failed:
                self.emit("failed", jobId, "job stalled more than allowable limit")
            for jobId in stalled:
                self.emit("stalled", jobId)

        except Exception as e:
            print("Error checking stalled jobs", e)
            self.emit('error', err)

    async def close(self, force: bool = False):
        """ "Close the worker" """
        if force:
            self.forceClosing = True

        self.closing = True

        await self.blockingRedisConnection.close()
        await self.redisConnection.close()

async def getFirstCompleted( taskSet: set):
    jobSet, pending = await asyncio.wait(taskSet, return_when=asyncio.FIRST_COMPLETED)
    for jobTask in jobSet:
        try: 
            job = jobTask.result()
            return (job, pending)
        except Exception as e:
            print("ERROR:", e)
            traceback.print_exc()
            return pending
