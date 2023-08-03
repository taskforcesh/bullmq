from typing import Callable
from uuid import uuid4
from bullmq.custom_errors import WaitingChildrenError
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
        self.id = uuid4().hex
        self.waiting = None
        self.blockUntil = 0
        self.limitUntil = 0
        self.drained = False
        self.qualifiedName = self.scripts.queue_keys.getQueueQualifiedName(name)

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

        token_postfix = 0

        while not self.closed:
            while not self.waiting and len(self.processing) < self.opts.get("concurrency") and not self.closing:
                token_postfix+=1
                token = f'{self.id}:{token_postfix}'
                waiting_job = asyncio.ensure_future(self.getNextJob(token))
                self.processing.add(waiting_job)

            try:
                jobs, pending = await getCompleted(self.processing)

                jobs_to_process = [self.processJob(job, job.token) for job in jobs]
                processing_jobs = [asyncio.ensure_future(
                    j) for j in jobs_to_process]
                pending.update(processing_jobs)
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

        if not self.waiting:
            self.waiting = self.waitForJob()

            try:
                job_id = await self.waiting
                job_instance = await self.moveToActive(token, job_id)
                return job_instance
            finally:
                self.waiting = None
        else:
            job_instance = await self.moveToActive(token)
            return job_instance

    async def moveToActive(self, token: str, job_id: str = None):
        if job_id and job_id.startswith('0:'):
            self.blockUntil = int(job_id.split(':')[1]) or 0

        result = await self.scripts.moveToActive(token, self.opts, job_id)
        job_data = None
        id = None
        limit_until = None
        delay_until = None

        if result:
            job_data, id, limit_until, delay_until = result

        return self.nextJobFromJobData(job_data, id, limit_until, delay_until, token)

    def nextJobFromJobData(self, job_data = None, job_id: str = None, limit_until: int = 0,
        delay_until: int = 0, token: str = None):
        self.limitUntil = max(limit_until, 0) or 0

        if not job_data:
            if not self.drained:
                self.drained = True
                self.blockUntil = 0

        if delay_until:
            self.blockUntil = max(delay_until, 0) or 0

        if job_data:
            self.drained = False
            job_instance = Job.fromJSON(self, job_data, job_id)
            job_instance.token = token
            return job_instance

    async def waitForJob(self):
        timeout = max(min(self.blockUntil - int(time.time() * 1000)
                        if self.blockUntil else 5000, 5000) / 1000, 0.00001)

        redis_version = await self.blockingRedisConnection.getRedisVersion()
        # Only Redis v6.0.0 and above supports doubles as block time
        timeout = int(math.ceil(timeout)) if isRedisVersionLowerThan(redis_version, '6.0.0') else timeout

        job_id = await self.bclient.brpoplpush(self.scripts.keys["wait"], self.scripts.keys["active"], timeout)

        return job_id

    async def processJob(self, job: Job, token: str):
        try:
            self.jobs.add((job, token))
            result = await self.processor(job, token)
            if not self.forceClosing:
                await self.scripts.moveToCompleted(job, result, job.opts.get("removeOnComplete", False), token, self.opts, fetchNext=not self.closing)
                job.returnvalue = result
            self.emit("completed", job, result)
        except WaitingChildrenError:
            return
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
        self.closing = True
        if force:
            self.forceClosing = True
            self.cancelProcessing()

        await self.blockingRedisConnection.close()
        await self.redisConnection.close()

    def cancelProcessing(self):
        for job in self.processing:
            if not job.done():
                job.cancel()


async def getCompleted(task_set: set) -> tuple[list[Job], set]:
    job_set, pending = await asyncio.wait(task_set, return_when=asyncio.FIRST_COMPLETED)
    jobs = [extract_result(job_task) for job_task in job_set]
    # we filter `None` out to remove:
    # a) an empty 'completed jobs' list; and
    # b) a failed extract_result
    jobs = list(filter(lambda j: j is not None, jobs))
    return jobs, pending
