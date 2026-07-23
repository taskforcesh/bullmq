"""
FlowProducer — atomic addition of dependent jobs as a tree.

Port of `src/classes/flow-producer.ts`. A flow is a tree of jobs where
each parent only becomes processable once all of its children have
completed. The whole tree is committed inside a single Redis
MULTI/EXEC transaction so callers never observe a partial tree.

Design notes:
- Adding a single flow and adding many flows in bulk share the same
  building block (`_queue_tree`), which is responsible for queuing one
  tree onto a pipeline and returning the number of commands it queued.
  Callers (`add`/`addBulk`) accumulate those counts themselves to
  recover each root's index in the flat list returned by
  `pipe.execute()`. Counting nodes ourselves avoids reaching into
  redis-py's private `pipe.command_stack`.
- `_apply_root_result` is the single place where we translate the
  root command's return value into either a raised exception (strict
  path, used by `add()`) or a silent best-effort id reconciliation
  (lenient path, used by `addBulk()`, matching Node's behavior).
"""

from typing import Optional, Union
from uuid import uuid4

from bullmq.error_code import ErrorCode
from bullmq.event_emitter import EventEmitter
from bullmq.job import Job
from bullmq.queue_keys import QueueKeys
from bullmq.redis_connection import RedisConnection
from bullmq.scripts import Scripts
from bullmq.types import QueueBaseOptions
from bullmq.utils import get_parent_key


class MinimalQueue:
    """
    Instantiate a MinimalQueue object
    """

    def __init__(self, name: str, queue_keys, redisConnection, scripts, opts: QueueBaseOptions = {}):
        """
        Initialize a connection
        """
        self.name = name
        self.redisConnection = redisConnection
        self.client = self.redisConnection.conn
        self.opts = opts
        self.prefix = opts.get("prefix", "bull")
        self.keys = queue_keys.getKeys(name)
        self.qualifiedName = queue_keys.getQueueQualifiedName(name)
        self.scripts = scripts


class FlowProducer(EventEmitter):
    """
    Instantiate a FlowProducer object
    """

    #TODO: pass only queueOpts, no need 2 parameters in next breaking change
    def __init__(self, redisOpts: Union[dict, str] = {}, opts: QueueBaseOptions = {}):
        """
        Initialize a connection
        """
        super().__init__()
        self.redisConnection = RedisConnection(
            redisOpts,
            skipVersionCheck=opts.get("skipVersionCheck", False)
        )
        self.client = self.redisConnection.conn
        self.opts: dict = opts
        self.prefix = opts.get("prefix", "bull")
        self.scripts = Scripts(
            self.prefix, "__default__", self.redisConnection)
        self.closing = False

    def queueFromNode(self, node: dict, queue_keys, prefix: str):
        return MinimalQueue(node.get("queueName"), queue_keys, self.redisConnection, self.scripts, {"prefix": prefix})

    async def addChildren(self, nodes, parent, queues_opts, pipe):
        children = []
        for node in nodes:
            job = await self.addNode(node, parent, queues_opts, pipe)
            children.append(job)
        return children

    async def addNode(self, node: dict, parent: dict, queues_opts: dict, pipe):
        prefix = node.get("prefix", self.prefix)
        queue = self.queueFromNode(node, QueueKeys(prefix), prefix)
        queue_name = node.get("queueName")
        queue_opts = queues_opts and queues_opts.get(queue_name)

        # Build a fresh merged dict so we never mutate the
        # caller-provided `queuesOptions[*].defaultJobOptions`; otherwise
        # node-level options like `parent`/`jobId` would persist across
        # subsequent nodes/flows that share the same defaults dict.
        default_opts = (queue_opts or {}).get('defaultJobOptions') or {}
        node_opts = node.get("opts") or {}
        parent_opts = parent.get("parentOpts")
        jobs_opts = {**default_opts, **node_opts, "parent": parent_opts}
        job_id = node_opts.get("jobId") or uuid4().hex

        job = Job(
            queue=queue,
            name=node.get("name"),
            data=node.get("data"),
            opts=jobs_opts,
            job_id=job_id
        )

        node_children = node.get("children", [])

        self.scripts.resetQueueKeys(queue_name)
        if len(node_children) > 0:
            parent_id = job_id

            await self.scripts.addParentJob(job, pipe)

            children = await self.addChildren(
                node_children,
                {
                    "parentOpts": {
                        "id": parent_id,
                        "queue": queue.qualifiedName,
                    }
                },
                queues_opts,
                pipe,
            )
            return {"job": job, "children": children}
        else:
            await self.scripts.addJob(job, pipe)
            return {"job": job}

    async def addNodes(self, nodes: list[dict], pipe):
        """
        Queue every root node in `nodes` onto `pipe`. Kept for backward
        compatibility with callers that don't need per-tree result
        mapping. `addBulk` uses `_queue_tree` directly so it can track
        each root's pipeline index.
        """
        trees = []
        for node in nodes:
            parent_opts = node.get("opts", {}).get("parent", None)
            jobs_tree = await self.addNode(
                node, {"parentOpts": parent_opts}, None, pipe
            )
            trees.append(jobs_tree)
        return trees

    async def add(self, flow: dict, opts: dict = {}) -> Optional[dict]:
        """
        Add a flow atomically. The whole tree is committed inside a
        single MULTI/EXEC. Mirrors the Node implementation:

        - A negative numeric return from the root command (e.g. parent
          job does not exist, see GH #3264) is translated to an
          exception so the caller cannot silently lose the root job.
        - A string id returned by the script (deduplication path) is
          reconciled onto `jobs_tree["job"].id`.

        Returns None if the producer is closing/closed.
        """
        if self.closing:
            return None

        parent_opts = flow.get("opts", {}).get("parent", None)
        parent_key = get_parent_key(parent_opts)
        queues_options = opts.get("queuesOptions")

        async with self.redisConnection.conn.pipeline(transaction=True) as pipe:
            # Only one tree, so the root command is at index 0.
            jobs_tree, _ = await self._queue_tree(pipe, flow, queues_options)
            exec_results = await pipe.execute()
            root_result = self._result_at(exec_results, 0)
            self._apply_root_result(
                jobs_tree, root_result, parent_key, strict=True
            )
            return jobs_tree

    async def addBulk(self, flows: list[dict]) -> Optional[list[dict]]:
        """
        Add multiple flows atomically in a single MULTI/EXEC.

        Matches Node's lenient bulk semantics: per-root errors are not
        raised; we only propagate deduplicated string ids back onto
        each tree. Callers that need strict error propagation should
        call `add()` per flow.

        Returns None if the producer is closing/closed.
        """
        if self.closing:
            return None

        async with self.redisConnection.conn.pipeline(transaction=True) as pipe:
            queued: list[tuple[dict, int]] = []
            running_index = 0
            for flow in flows:
                jobs_tree, queued_count = await self._queue_tree(
                    pipe, flow, queues_options=None
                )
                queued.append((jobs_tree, running_index))
                running_index += queued_count

            exec_results = await pipe.execute()

            for jobs_tree, root_index in queued:
                root_result = self._result_at(exec_results, root_index)
                self._apply_root_result(
                    jobs_tree, root_result, parent_key=None, strict=False
                )

            return [tree for tree, _ in queued]

    async def _queue_tree(
        self,
        pipe,
        flow: dict,
        queues_options: Optional[dict],
    ) -> tuple[dict, int]:
        """
        Queue one flow (root + children) onto `pipe` and return the
        resulting `JobNode`-shaped dict together with the number of
        commands that were queued for this tree. Callers track the
        root-command index themselves by accumulating the returned
        count. Counting nodes ourselves avoids reaching into redis-py's
        `pipe.command_stack`, which is not a stable public API.
        """
        parent_opts = flow.get("opts", {}).get("parent", None)
        jobs_tree = await self.addNode(
            flow, {"parentOpts": parent_opts}, queues_options, pipe
        )
        # `addNode` queues exactly one command per visited node
        # (`addParentJob` for nodes with children, `addJob` for leaves),
        # so the command count equals the total node count of the tree.
        return jobs_tree, self._count_nodes(flow)

    @staticmethod
    def _count_nodes(node: dict) -> int:
        """Return the total number of nodes in a flow definition (root
        plus all descendant children)."""
        return 1 + sum(
            FlowProducer._count_nodes(child)
            for child in (node.get("children") or [])
        )

    @staticmethod
    def _result_at(exec_results, index: int):
        """Safe lookup into a pipeline result list."""
        if not exec_results or index < 0 or index >= len(exec_results):
            return None
        return exec_results[index]

    def _apply_root_result(
        self,
        jobs_tree: dict,
        root_result,
        parent_key: Optional[str],
        strict: bool,
    ) -> None:
        """
        Translate a root command's result into either an exception
        (strict path) or an id reconciliation (lenient path).

        - `strict=True` (used by `add`): a negative numeric code raises
          via `_toFlowError`.
        - `strict=False` (used by `addBulk`): numeric codes are
          ignored, matching Node's bulk semantics.

        A string result (deduplication) always wins and is assigned to
        `jobs_tree["job"].id` so the caller observes the real id.
        """
        if root_result is None:
            return
        if isinstance(root_result, int):
            if strict and root_result < 0:
                raise self._toFlowError(root_result, parent_key)
            return
        if isinstance(root_result, str):
            jobs_tree["job"].id = root_result

    def _toFlowError(self, code: int, parent_key: Optional[str]) -> Exception:
        """
        Translate the numeric error code returned by the addJob Lua
        script into a descriptive Exception. Mirrors Node's
        `toFlowError`. The numeric `code` is attached to the exception
        so programmatic callers can branch on it the same way Node
        consumers branch on `(err as any).code`.
        """
        if code == ErrorCode.ParentJobNotExist.value:
            err = Exception(f"Missing key for parent job {parent_key}. addJob")
        elif code == ErrorCode.ParentJobCannotBeReplaced.value:
            err = Exception(
                f"The parent job {parent_key} cannot be replaced. addJob"
            )
        else:
            err = Exception(f"Unknown code {code} error for addJob")
        err.code = code
        return err

    async def close(self):
        """
        Close the flow instance.
        """
        self.closing = True
        return await self.redisConnection.close()

    def disconnect(self):
        """
        Force-disconnect the underlying Redis connection.
        """
        return self.redisConnection.disconnect()
