from typing import Callable
from uuid import uuid4
from bullmq.scripts import Scripts
from bullmq.redis_connection import RedisConnection
from bullmq.event_emitter import EventEmitter
from bullmq.job import Job
from bullmq.timer import Timer
from bullmq.types import WorkerOptions
from bullmq.utils import isRedisVersionLowerThan, extract_result

import asyncio
import traceback
import time
import math

class Worker(EventEmitter):
    def __init__(self, name: str, processor: Callable[[Job, str], asyncio.Future], opts: WorkerOptions = {}):
        super().__init__()
        self.name = name
        self.processor = processor
        final_opts = {
            "concurrency": 1,
            "lockDuration": 30000,
            "maxStalledCount": 1,
            "stalledInterval": 30000,
        }
        final_opts.update(opts or {})
        self.opts = final_opts
        redis_opts = opts.get("connection", {})
        self.redisConnection = RedisConnection(redis_opts)
        self.blockingRedisConnection = RedisConnection(redis_opts)
        self.client = self.redisConnection.conn
        self.bclient = self.blockingRedisConnection.conn
        self.prefix = opts.get("prefix", "bull")
        self.scripts = Scripts(opts.get("prefix", "bull"), name, self.redisConnection)
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

        self.timer = Timer(
            (self.opts.get("lockDuration") / 2) / 1000, self.extendLocks)
        self.stalledCheckTimer = Timer(self.opts.get(
            "stalledInterval") / 1000, self.runStalledJobsCheck)
        self.running = True
        jobs = []

        token = uuid4().hex

        while not self.closed:
            if len(jobs) == 0 and len(self.processing) < self.opts.get("concurrency") and not self.closing:
                waiting_job = asyncio.ensure_future(self.getNextJob(token))
                self.processing.add(waiting_job)

            if len(jobs) > 0:
                jobs_to_process = [self.processJob(job, token) for job in jobs]
                processing_jobs = [asyncio.ensure_future(
                    j) for j in jobs_to_process]
                self.processing.update(processing_jobs)

            try:
                jobs, pending = await getCompleted(self.processing)

                self.processing = pending

                if (len(jobs) == 0 or len(self.processing) == 0) and self.closing:
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
        """
        Returns a promise that resolves to the next job in queue.
        @param token: worker token to be assigned to retrieved job
        @returns a Job or undefined if no job was available in the queue.
        """
        # First try to move a job from the waiting list to the active list
        result = await self.scripts.moveToActive(token, self.opts)
        job = None
        job_id = None
        limit_until = None
        delay_until = None

        if result:
            job, job_id, limit_until, delay_until = result

        # If there are no jobs in the waiting list we keep waiting with BRPOPLPUSH
        if job is None:
            timeout = min(delay_until - int(time.time() * 1000)
                          if delay_until else 5000, 5000) / 1000
            
            redis_version = await self.blockingRedisConnection.getRedisVersion()
            # Only Redis v6.0.0 and above supports doubles as block time
            timeout = int(math.ceil(timeout)) if isRedisVersionLowerThan(redis_version, '6.0.0') else timeout

            job_id = await self.bclient.brpoplpush(self.scripts.keys["wait"], self.scripts.keys["active"], timeout)
            if job_id:
                job, job_id, limit_until, delay_until = await self.scripts.moveToActive(token, self.opts, job_id)

        if job and job_id:
            return Job.fromJSON(self, job, job_id)

    async def processJob(self, job: Job, token: str):
        try:
            self.jobs.add((job, token))
            result = await self.processor(job, token)
            if not self.forceClosing:
                await self.scripts.moveToCompleted(job, result, job.opts.get("removeOnComplete", False), token, self.opts, fetchNext=not self.closing)
            self.emit("completed", job, result)
        except Exception as err:
            try:
                print("Error processing job", err)
                if not self.forceClosing:
                    await job.moveToFailed(err, token)

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
                self.emit("failed", jobId,
                          "job stalled more than allowable limit")
            for jobId in stalled:
                self.emit("stalled", jobId)

        except Exception as e:
            print("Error checking stalled jobs", e)
            self.emit('error', e)

    async def close(self, force: bool = False):
        """
        Close the worker
        """
        if force:
            self.forceClosing = True
            self.cancelProcessing()

        self.closing = True

        await self.blockingRedisConnection.close()
        await self.redisConnection.close()

    def cancelProcessing(self):
        for job in self.processing:
            if not job.done():
                job.cancel()


async def getCompleted(task_set: set) -> tuple[list[Job], list]:
    job_set, pending = await asyncio.wait(task_set, return_when=asyncio.FIRST_COMPLETED)
    jobs = [extract_result(job_task) for job_task in job_set]
    # we filter `None` out to remove:
    # a) an empty 'completed jobs' list; and
    # b) a failed extract_result
    jobs = list(filter(lambda j: j is not None, jobs))
    return jobs, pending
