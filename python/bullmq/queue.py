import asyncio
from bullmq.redis_connection import RedisConnection
from bullmq.types import QueueOptions, RetryJobsOptions, JobOptions
from bullmq.utils import extract_result
from bullmq.scripts import Scripts
from bullmq.job import Job


class Queue:
    """
    Instantiate a Queue object
    """

    def __init__(self, name: str, redisOpts: dict | str = {}, opts: QueueOptions = {}):
        """
        Initialize a connection
        """
        self.name = name
        self.redisConnection = RedisConnection(redisOpts)
        self.client = self.redisConnection.conn
        self.opts = opts
        self.prefix = opts.get("prefix", "bull")
        self.scripts = Scripts(
            self.prefix, name, self.redisConnection)

    async def add(self, name: str, data, opts: JobOptions = {}):
        """
        Adds a new job to the queue.

        @param name: Name of the job to be added to the queue,.
        @param data: Arbitrary data to append to the job.
        @param opts: Job options that affects how the job is going to be processed.
        """
        job = Job(self, name, data, opts)
        job_id = await self.scripts.addJob(job)
        job.id = job_id
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
        paused_key_exists = await self.client.hexists(self.opts.get("prefix", f"bull:{self.name}:meta"), "paused")
        return paused_key_exists == 1

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
            if cursor is None or cursor == 0 or cursor == "0":
                break

    async def retryJobs(self, opts: RetryJobsOptions = {}):
        """
        Retry all the failed jobs.
        """
        while True:
            cursor = await self.scripts.retryJobs(
                opts.get("state"),
                opts.get("count"),
                opts.get("timestamp")
            )
            if cursor is None or cursor == 0 or cursor == "0":
                break

    def trimEvents(self, maxLength: int):
        """
        Trim the event stream to an approximately maxLength.

        @param maxLength:
        """
        return self.client.xtrim(f"{self.prefix}:{self.name}:events", maxlen = maxLength, approximate = "~")

    def removeDeprecatedPriorityKey(self):
        """
        Delete old priority helper key.
        """
        return self.client.delete(f"{self.prefix}:{self.name}:priority")

    async def getJobCounts(self, *types):
        """
        Returns the job counts for each type specified or every list/set in the queue by default.

        @returns: An object, key (type) and value (count)
        """
        current_types = self.sanitizeJobTypes(types)

        responses = await self.scripts.getCounts(current_types)
        counts = {}

        for index, val in enumerate(responses):
            counts[current_types[index]] = val or 0
        return counts

    async def getJobs(self, types, start=0, end=-1, asc:bool=False):
        current_types = self.sanitizeJobTypes(types)
        job_ids = await self.scripts.getRanges(current_types, start, end, asc)
        tasks = [asyncio.create_task(Job.fromId(self, i)) for i in job_ids]   
        job_set, _ = await asyncio.wait(tasks, return_when=asyncio.ALL_COMPLETED)
        jobs = [extract_result(job_task) for job_task in job_set]
        jobs_len = len(jobs)

        # we filter `None` out to remove:
        jobs = list(filter(lambda j: j is not None, jobs))

        for index, job_id in enumerate(job_ids):
            pivot_job = jobs[index]

            for i in range(index,jobs_len):
                current_job = jobs[i]
                if current_job and current_job.id == job_id:
                    jobs[index] = current_job
                    jobs[i] = pivot_job

        return jobs

    def sanitizeJobTypes(self, types):
        current_types = list(types)

        if len(types) > 0:
            sanitized_types = current_types.copy()

            try:
                sanitized_types.index('waiting')
                sanitized_types.append('paused')
            except ValueError:
                pass
            set_res = set(sanitized_types)
            list_res = (list(set_res))

            return list_res
        return [
            'active',
            'completed',
            'delayed',
            'failed',
            'paused',
            'waiting',
            'waiting-children'
        ]

    def close(self):
        """
        Close the queue instance.
        """
        return self.redisConnection.close()
