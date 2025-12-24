from typing import Callable
from uuid import uuid4
from redis.exceptions import ConnectionError
from bullmq.custom_errors import UnrecoverableError, WaitingChildrenError
from bullmq.scripts import Scripts
from bullmq.redis_connection import RedisConnection
from bullmq.event_emitter import EventEmitter
from bullmq.job import Job
from bullmq.timer import Timer
from bullmq.types import WorkerOptions
from bullmq.utils import extract_result

import asyncio
import traceback
import time
import math

maximum_block_timeout = 10
# 1 millisecond is chosen because the granularity of our timestamps are milliseconds.
# Obviously we can still process much faster than 1 job per millisecond but delays and
# rate limits will never work with more accuracy than 1ms.
minimum_block_timeout = 0.001


class Worker(EventEmitter):
    def __init__(self, name: str, processor: Callable[[Job, str], asyncio.Future], opts: WorkerOptions = {}):
        super().__init__()
        self.name = name
        self.processor = processor
        final_opts = {
            "drainDelay": 5,
            "concurrency": 1,
            "lockDuration": 30000,
            "maxStalledCount": 1,
            "stalledInterval": 30000,
            "runRetryDelay": 15000,
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
        self.paused = False
        self.processing = set()
        self.jobs = set()
        self.id = uuid4().hex
        self.waiting = None
        self.blockUntil = 0
        self.limitUntil = 0
        self.drained = False
        self.qualifiedName = self.scripts.queue_keys.getQueueQualifiedName(name)

        if processor:
            if opts.get("autorun", True):
                asyncio.ensure_future(self.run())

    async def run(self):
        if self.running:
            raise Exception("Worker is already running")

        self.timer = Timer(
            (self.opts.get("lockDuration") / 2) / 1000, self.extendLocks, self.emit)
        self.stalledCheckTimer = Timer(self.opts.get(
            "stalledInterval") / 1000, self.runStalledJobsCheck, self.emit)
        self.running = True
        jobs = []

        token_postfix = 0

        while not self.closed:
            while not self.waiting and len(self.processing) < self.opts.get("concurrency") and not self.closing:
                token_postfix+=1
                token = f'{self.id}:{token_postfix}'
                
                # Use retryIfFailed to wrap getNextJob call, similar to TypeScript worker
                async def get_next_job_wrapped():
                    return await self.getNextJob(token)
                
                waiting_job = asyncio.ensure_future(
                    self.retryIfFailed(
                        get_next_job_wrapped,
                        {
                            "delay_in_ms": self.opts.get("runRetryDelay"),
                            "only_emit_error": True,
                        }
                    )
                )
                self.processing.add(waiting_job)

            try:
                jobs, pending = await getCompleted(self.processing, self.emit)

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
        if not self.waiting and self.drained:
            self.waiting = self.waitForJob()

            try:
                self.blockUntil = await self.waiting
                timestamp = int(time.time() * 1000)

                if self.blockUntil <= 0 or self.blockUntil <= timestamp:
                    job_instance = await self.moveToActive(token)
                    return job_instance
            finally:
                self.waiting = None
        else:
            job_instance = await self.moveToActive(token)
            return job_instance

    async def moveToActive(self, token: str):
        result = await self.scripts.moveToActive(token, self.opts)
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
            self.blockUntil = max(int(delay_until), 0) or 0

        if job_data:
            self.drained = False
            job_instance = Job.fromJSON(self, job_data, job_id)
            job_instance.token = token
            return job_instance

    async def waitForJob(self):
        block_timeout = self.getBlockTimeout(self.blockUntil)
        block_timeout = block_timeout if self.blockingRedisConnection.capabilities.get("canDoubleTimeout", False) else math.ceil(block_timeout)

        result = await self.bclient.bzpopmin(self.scripts.keys["marker"], block_timeout)
        if result:
            [_key, member, score] = result

            if member:
                return int(score)
            else:
                return 0
        return 0

    def getBlockTimeout(self, block_until: int):
        if block_until:
            block_timeout = None
            block_delay = block_until - int(time.time() * 1000)
            if block_delay < self.minimumBlockTimeout * 1000:
                return self.minimumBlockTimeout
            else:
                block_timeout = block_delay / 1000
            # We restrict the maximum block timeout to 10 second to avoid
            # blocking the connection for too long in the case of reconnections
            # reference: https://github.com/taskforcesh/bullmq/issues/1658
            return min(block_timeout, maximum_block_timeout)
        else:
            return max(self.opts.get("drainDelay", 5), self.minimumBlockTimeout)

    @property
    def minimumBlockTimeout(self):
        return minimum_block_timeout if self.blockingRedisConnection.capabilities.get("canBlockFor1Ms", True) else 0.002

    async def processJob(self, job: Job, token: str):
        try:
            self.emit("active", job, "waiting")

            self.jobs.add((job, token))
            
            if job.deferredFailure:
                await job.moveToFailed(UnrecoverableError(job.deferredFailure), token)
                self.emit("failed", job, UnrecoverableError(job.deferredFailure))
                return

            result = await self.processor(job, token)
            if not self.forceClosing:
                # Currently we do not support pre-fetching jobs as in NodeJS version.
                # nextJob = await self.scripts.moveToCompleted(job, result, job.opts.get("removeOnComplete", False), token, fetchNext=not self.closing)
                await self.scripts.moveToCompleted(job, result, job.opts.get("removeOnComplete", False), token, fetchNext=False)
                job.returnvalue = result
                job.attemptsMade = job.attemptsMade + 1
            self.emit("completed", job, result)
        except WaitingChildrenError:
            return
        except Exception as err:
            try:
                if not self.forceClosing:
                    await job.moveToFailed(err, token)

                self.emit("failed", job, err)
            except Exception as err:
                self.emit("error", err, job)
        finally:
            self.jobs.remove((job, token))

    async def retryIfFailed(self, fn, opts=None):
        """
        Retry a coroutine function if it fails, with delay and max retries.
        :param fn: Coroutine function to execute.
        :param opts: Dictionary with options:
            - delay_in_ms: Delay between retries in milliseconds.
            - max_retries: Maximum number of retries.
            - only_emit_error: If True, only emit error and do not raise.
        """
        if opts is None:
            opts = {}
        delay_in_ms = opts.get("delay_in_ms", 15000)
        max_retries = opts.get("max_retries", float('inf'))
        only_emit_error = opts.get("only_emit_error", False)

        retry = 0
        while retry < max_retries:
            try:
                return await fn()
            except Exception as err:
                # Check if this is a connection error that should be retried
                is_connection_error = self.isConnectionError(err)
                
                if not is_connection_error:
                    # Swallow error if locally not paused or not closing since we did not force a disconnection
                    if not (self.paused or self.closing):
                        self.emit("error", err)
                    
                    if only_emit_error:
                        return None
                    else:
                        raise err
                else:
                    # For connection errors, wait and retry
                    if delay_in_ms and not self.closing and not self.closed:
                        await asyncio.sleep(delay_in_ms / 1000.0)
                    
                    retry += 1
                    if retry >= max_retries:
                        # If we've reached max retries, raise the last error
                        raise err
        
        return None
    
    def isConnectionError(self, error):
        """
        Check if an error is a connection-related error.
        """
        return isinstance(error, ConnectionError)

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
            traceback.print_exc()

    async def runStalledJobsCheck(self):
        try:
            stalled = await self.scripts.moveStalledJobsToWait(self.opts.get("maxStalledCount"), self.opts.get("stalledInterval"))
            for jobId in stalled:
                self.emit("stalled", jobId)

        except Exception as e:
            self.emit('error', e)

    async def close(self, force: bool = False):
        """
        Closes the worker and related redis connections.

        This method waits for current jobs to finalize before returning.
        """
        self.closing = True
        if force:
            self.forceClosing = True
            self.cancelProcessing()

        if not force and len(self.processing) > 0:
            await asyncio.wait(self.processing, return_when=asyncio.ALL_COMPLETED)

        await self.blockingRedisConnection.close()
        await self.redisConnection.close()
        self.closed = True
        self.emit('closed')

    async def pause(self, do_not_wait_active: bool = False):
        """
        Pauses the worker, preventing it from processing new jobs.

        This method waits for current jobs to finalize before returning.
        """
        if not self.paused:
            self.paused = True
            if not do_not_wait_active and len(self.processing) > 0:
                await asyncio.wait(self.processing, return_when=asyncio.ALL_COMPLETED)
        self.emit('paused')

    def resume(self):
        """
        Resumes processing of this worker (if paused).
        """
        if self.paused:
            self.paused = False
            self.emit('resumed')

    def cancelProcessing(self):
        for job in self.processing:
            if not job.done():
                job.cancel()


async def getCompleted(task_set: set, emit_callback) -> tuple[list[Job], set]:
    job_set, pending = await asyncio.wait(task_set, return_when=asyncio.FIRST_COMPLETED)
    jobs = [extract_result(job_task, emit_callback) for job_task in job_set]
    # we filter `None` out to remove:
    # a) an empty 'completed jobs' list; and
    # b) a failed extract_result
    jobs = list(filter(lambda j: j is not None, jobs))
    return jobs, pending
