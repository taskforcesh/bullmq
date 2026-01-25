import asyncio
from typing import Union
from bullmq.event_emitter import EventEmitter
from bullmq.redis_connection import RedisConnection
from bullmq.types import QueueBaseOptions, RetryJobsOptions, JobOptions, PromoteJobsOptions
from bullmq.utils import extract_result, is_redis_cluster, get_cluster_nodes, get_node_client
from bullmq.scripts import Scripts
from bullmq.job import Job


class Queue(EventEmitter):
    """
    Instantiate a Queue object
    """

    def __init__(self, name: str, opts: QueueBaseOptions = {}):
        """
        Initialize a connection
        """
        self.name = name
        redisOpts = opts.get("connection", {})
        self.redisConnection = RedisConnection(redisOpts)
        self.client = self.redisConnection.conn
        self.opts = opts
        self.jobsOpts = opts.get("defaultJobOptions", {})
        self.prefix = opts.get("prefix", "bull")
        self.scripts = Scripts(
            self.prefix, name, self.redisConnection)
        self.keys = self.scripts.queue_keys.getKeys(name)
        self.qualifiedName = self.scripts.queue_keys.getQueueQualifiedName(name)

    def toKey(self, type: str):
        return self.scripts.queue_keys.toKey(self.name, type)

    async def add(self, name: str, data, opts: JobOptions = {}):
        """
        Adds a new job to the queue.

        @param name: Name of the job to be added to the queue,.
        @param data: Arbitrary data to append to the job.
        @param opts: Job options that affects how the job is going to be processed.
        """
        merged_opts = {**self.jobsOpts, **(opts or {})}
        job = Job(self, name, data, merged_opts)
        job_id = await self.scripts.addJob(job)
        job.id = job_id
        return job

    async def addBulk(self, jobs: list[dict[str, Union[dict, str]]]):
        """
        Adds an array of jobs to the queue. This method may be faster than adding
        one job at a time in a sequence
        """
        jobs_data = []
        for job in jobs:
            opts = {**self.jobsOpts, **(job.get("opts") or {})}

            jobs_data.append({
                "name": job.get("name"),
                "data": job.get("data"),
                "opts": opts
            })

        result = []
        async with self.redisConnection.conn.pipeline(transaction=True) as pipe:
            for job_data in jobs_data:
                current_job_opts = job_data.get("opts", {})
                job = Job(
                    queue=self,
                    name=job_data.get("name"),
                    data=job_data.get("data"),
                    opts=current_job_opts,
                    job_id=current_job_opts.get("jobId")
                    )
                job_id = await self.scripts.addJob(job, pipe)
                job.id = job_id
                result.append(job)
            job_ids = await pipe.execute()
            for index, job_id in enumerate(job_ids):
                result[index].id = job_id

        return result

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
        paused_key_exists = await self.client.hexists(self.keys["meta"], "paused")
        return paused_key_exists == 1

    def getRateLimitTtl(self):
        """
        Returns the time to live for a rate limited key in milliseconds.
        """
        return self.client.pttl(self.keys["limiter"])

    async def get_workers(self):
        """
        Get the worker list related to the queue. i.e. all the known
        workers that are available to process jobs for this queue.
        Note: Some Redis providers do not support CLIENT LIST.
        """
        client_name_prefix = self.qualifiedName

        def matcher(name: str):
            return name == client_name_prefix or name.startswith(f"{client_name_prefix}:w:")

        return await self._base_get_clients(matcher)

    async def get_workers_count(self):
        workers = await self.get_workers()
        return len(workers)

    async def _base_get_clients(self, matcher):
        client = self.client
        try:
            if is_redis_cluster(client):
                nodes = get_cluster_nodes(client)
                clients_per_node = []
                for node in nodes:
                    node_client = get_node_client(node)
                    client_list = await self._get_client_list(node_client)
                    clients_per_node.append(self._parse_client_list(client_list, matcher))

                if not clients_per_node:
                    return []

                return max(clients_per_node, key=len)

            client_list = await self._get_client_list(client)
            return self._parse_client_list(client_list, matcher)
        except Exception as err:
            message = str(err)
            if "unknown command" in message and "CLIENT" in message:
                return [{"name": "CLIENT LIST not supported"}]
            raise

    async def _get_client_list(self, client):
        if hasattr(client, "client_list"):
            return await client.client_list()
        return await client.execute_command("CLIENT", "LIST")

    def _parse_client_list(self, client_list, matcher):
        if isinstance(client_list, bytes):
            client_list = client_list.decode()

        clients = []
        if isinstance(client_list, list):
            clients = client_list
        elif isinstance(client_list, str):
            lines = client_list.splitlines()
            for line in lines:
                if not line:
                    continue
                client = {}
                for key_value in line.split(" "):
                    if "=" not in key_value:
                        continue
                    key, value = key_value.split("=", 1)
                    client[key] = value
                clients.append(client)

        result = []
        for client in clients:
            name = ""
            if isinstance(client, dict):
                name = client.get("name") or ""
                if isinstance(name, bytes):
                    name = name.decode()
            if matcher(name):
                client_copy = dict(client)
                client_copy["rawname"] = name
                client_copy["name"] = self.name
                result.append(client_copy)

        return result

    async def getJobLogs(self, job_id:str, start = 0, end = -1, asc = True):
        """
        Returns the logs for a given Job.

        @param job_id: The id of the job to get the logs for.
        @param start: Zero based index from where to start returning jobs.
        @param end: Zero based index where to stop returning jobs.
        @param asc: If true, the jobs will be returned in ascending order.
        """

        logs_key = self.toKey(job_id + ":logs")
        pipe = self.redisConnection.conn.pipeline(transaction=True)
        if asc:
            pipe.lrange(logs_key, start, end)
        else:
            pipe.lrange(logs_key, -(end+1), -(start+1))
        pipe.llen(logs_key)
        result = await pipe.execute()
        if not asc:
            result[0].reverse()
        return {
            "logs": result[0],
            "count": result[1]
        }
   
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

    async def drain(self, delayed: bool = False):
        """
        Drains the queue, removes all jobs that are waiting
        or delayed, but not active, completed or failed.
        
        @param delayed: Pass True if it should also clean the delayed jobs.
        """
        await self.scripts.drain(delayed)

    async def retryJobs(self, opts: RetryJobsOptions = {}):
        """
        Retry all the failed or completed jobs.
        """
        while True:
            cursor = await self.scripts.retryJobs(
                opts.get("state"),
                opts.get("count"),
                opts.get("timestamp")
            )
            if cursor is None or cursor == 0 or cursor == "0":
                break

    async def promoteJobs(self, opts: PromoteJobsOptions = {}):
        """
        Retry all the delayed jobs.
        """
        while True:
            cursor = await self.scripts.promoteJobs(
                opts.get("count")
            )
            if cursor is None or cursor == 0 or cursor == "0":
                break

    def trimEvents(self, maxLength: int):
        """
        Trim the event stream to an approximately maxLength.

        @param maxLength:
        """
        return self.client.xtrim(self.keys["events"], maxlen=maxLength, approximate="~")

    def removeDeprecatedPriorityKey(self):
        """
        Delete old priority helper key.
        """
        return self.client.delete(self.toKey("priority"))

    async def getJobCountByTypes(self, *types):
        result = await self.getJobCounts(*types)
        sum = 0
        for attribute in result:
            sum += result[attribute]
        return sum

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

    async def getCountsPerPriority(self, priorities):
        """
        Returns the number of jobs per priority.

        @returns: An object, key (priority) and value (count)
        """
        set_priorities = set(priorities)
        unique_priorities = (list(set_priorities))

        responses = await self.scripts.getCountsPerPriority(unique_priorities)

        counts = {}

        for index, val in enumerate(responses):
            counts[f"{unique_priorities[index]}"] = val or 0
        return counts

    async def clean(self, grace: int, limit: int, type: str):
        """
        Cleans jobs from a queue. Similar to drain but keeps jobs within a certain
        grace period
        
        * @returns: Id jobs from the deleted records
        """
        jobs = await self.scripts.cleanJobsInSet(type, grace, limit)

        return jobs

    def getJobState(self, job_id: str):
        return self.scripts.getState(job_id)

    def getCompletedCount(self):
        return self.getJobCountByTypes('completed')

    def getDelayedCount(self):
        return self.getJobCountByTypes('delayed')

    def getFailedCount(self):
        return self.getJobCountByTypes('failed')

    def getWaitingCount(self):
        return self.getJobCountByTypes('waiting')

    def getActive(self, start=0, end=-1):
        return self.getJobs(['active'], start, end, True)

    def getCompleted(self, start = 0, end=-1):
        return self.getJobs(['completed'], start, end, False)

    def getDelayed(self, start = 0, end=-1):
        return self.getJobs(['delayed'], start, end, True)

    def getFailed(self, start = 0, end=-1):
        return self.getJobs(['completed'], start, end, False)

    def getPrioritized(self, start = 0, end=-1):
        return self.getJobs(['prioritized'], start, end, True)

    def getWaiting(self, start = 0, end=-1):
        return self.getJobs(['waiting'], start, end, True)

    def getWaitingChildren(self, start = 0, end=-1):
        return self.getJobs(['waiting-children'], start, end, True)

    async def getJobs(self, types, start=0, end=-1, asc:bool=False):
        current_types = self.sanitizeJobTypes(types)
        job_ids = await self.scripts.getRanges(current_types, start, end, asc)
        tasks = [asyncio.create_task(Job.fromId(self, i)) for i in job_ids]
        job_set, _ = await asyncio.wait(tasks, return_when=asyncio.ALL_COMPLETED)
        jobs = [extract_result(job_task, self.emit) for job_task in job_set]
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
                    continue

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

    async def close(self):
        """
        Close the queue instance.
        """
        return await self.redisConnection.close()

    def remove(self, job_id: str, opts: dict = {}):
        return self.scripts.remove(job_id, opts.get("removeChildren", True))
