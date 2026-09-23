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

from bullmq.backends import create_backend
from bullmq.error_code import ErrorCode
from bullmq.event_emitter import EventEmitter
from bullmq.job import Job
from bullmq.types import QueueBaseOptions
from bullmq.utils import get_parent_key


class MinimalQueue:
    """
    A lightweight queue view used by :class:`FlowProducer` for each node in a
    flow. It carries the node's queue identity and a backend scoped to that
    queue (sharing the flow producer's connection), which is what :class:`Job`
    needs to be constructed and, if necessary, operated on.
    """

    def __init__(self, name: str, backend, opts: QueueBaseOptions = {}):
        self.name = name
        self.opts = opts
        self.prefix = opts.get("prefix", "bull")
        self.backend = backend
        self.qualifiedName = backend.qualifiedName


class FlowProducer(EventEmitter):
    """
    Instantiate a FlowProducer object
    """

    def __init__(
        self,
        redisOpts: Union[dict, str, None] = None,
        opts: Optional[QueueBaseOptions] = None,
    ):
        """
        Initialize a connection
        """
        super().__init__()

        if opts is None and isinstance(redisOpts, dict) and (
            "prefix" in redisOpts
            or "connection" in redisOpts
            or "backend" in redisOpts
            or "skipVersionCheck" in redisOpts
        ):
            opts = redisOpts
            redisOpts = None

        self.opts: dict = dict(opts or {})
        if redisOpts is not None:
            self.opts["connection"] = redisOpts
        self.prefix = self.opts.get("prefix", "bull")
        self.backend = create_backend("__default__", self.opts)
        self.closing = False

    def queueFromNode(self, node: dict, prefix: str):
        queue_name = node.get("queueName")
        node_backend = self.backend.forQueue(queue_name, prefix)
        return MinimalQueue(queue_name, node_backend, {"prefix": prefix})

    async def addChildren(self, nodes, parent, queues_opts, entries):
        children = []
        for node in nodes:
            job = await self.addNode(node, parent, queues_opts, entries)
            children.append(job)
        return children

    async def addNode(self, node: dict, parent: dict, queues_opts: dict, entries: list):
        """
        Build the job for ``node`` (and, recursively, its children) and append
        it to the flat, pre-ordered ``entries`` list that is later inserted
        atomically via ``backend.addFlow``. A node with children is added as a
        parent job (before its children, which reference it).
        """
        prefix = node.get("prefix", self.prefix)
        queue = self.queueFromNode(node, prefix)
        queue_name = node.get("queueName")
        queue_opts = queues_opts and queues_opts.get(queue_name)

        # Build a fresh merged dict so we never mutate the
        # caller-provided `queuesOptions[*].defaultJobOptions`; otherwise
        # node-level options like `parent`/`jobId` would persist across
        # subsequent nodes/flows that share the same defaults dict.
        default_opts = (queue_opts or {}).get("defaultJobOptions") or {}
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

        if len(node_children) > 0:
            parent_id = job_id

            entries.append({"job": job, "is_parent": True})

            children = await self.addChildren(
                node_children,
                {
                    "parentOpts": {
                        "id": parent_id,
                        "queue": queue.qualifiedName,
                    }
                },
                queues_opts,
                entries,
            )
            return {"job": job, "children": children}
        else:
            entries.append({"job": job, "is_parent": False})
            return {"job": job}

    async def addNodes(self, nodes: list[dict], entries: list):
        """
        Queue every root node in `nodes` onto `entries`. Kept for backward
        compatibility with callers that don't need per-tree result
        mapping. `addBulk` uses `_queue_tree` directly so it can track
        each root's result index.
        """
        trees = []
        for node in nodes:
            parent_opts = node.get("opts", {}).get("parent", None)
            jobs_tree = await self.addNode(
                node, {"parentOpts": parent_opts}, None, entries
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

        entries: list = []
        jobs_tree, _ = await self._queue_tree(entries, flow, queues_options)
        results = await self.backend.addFlow(entries)
        root_result = self._result_at(results, 0)
        self._apply_root_result(jobs_tree, root_result, parent_key, strict=True)
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

        entries: list = []
        queued: list[tuple[dict, int]] = []
        running_index = 0
        for flow in flows:
            jobs_tree, queued_count = await self._queue_tree(
                entries, flow, queues_options=None
            )
            queued.append((jobs_tree, running_index))
            running_index += queued_count

        results = await self.backend.addFlow(entries)

        for jobs_tree, root_index in queued:
            root_result = self._result_at(results, root_index)
            self._apply_root_result(
                jobs_tree, root_result, parent_key=None, strict=False
            )

        return [tree for tree, _ in queued]

    async def _queue_tree(
        self,
        entries: list,
        flow: dict,
        queues_options: Optional[dict],
    ) -> tuple[dict, int]:
        """
        Queue one flow (root + children) onto `entries` and return the
        resulting `JobNode`-shaped dict together with the number of
        backend results consumed by this tree. Callers track the root
        result index themselves by accumulating the returned count.
        """
        parent_opts = flow.get("opts", {}).get("parent", None)
        jobs_tree = await self.addNode(
            flow, {"parentOpts": parent_opts}, queues_options, entries
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
        return await self.backend.close()

    async def disconnect(self):
        """
        Force-disconnect the underlying backend connection.
        """
        self.closing = True
        return await self.backend.disconnect()
