---
description: Lock-renewal and cancellation behavior is documented in shared worker sections.
---

# Lock Manager

To avoid duplicated content across ports, worker lock-renewal and cancellation behavior is documented in shared worker guide sections:

- [Cancelling Jobs](../guide/workers/cancelling-jobs.md)
- [Stalled Jobs](../guide/workers/stalled-jobs.md)

Python implementation details are in:

- [python/bullmq/lock_manager.py](https://github.com/taskforcesh/bullmq/blob/master/python/bullmq/lock_manager.py)
- [src/commands/extendLocks-1.lua](https://github.com/taskforcesh/bullmq/blob/master/src/commands/extendLocks-1.lua)
