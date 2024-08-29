# Troubleshooting

In this section, you will be able to find hints and solutions for some common errors you might encounter when using BullMQ.

#### Missing Locks

An error that can be thrown by the workers has the following structure: “Missing lock for job 1234. moveToFinished.” This error occurs when a job being processed by a worker unexpectedly loses its “lock.”

When a worker processes a job, it requires a special lock key to ensure that the job is currently “owned” by that worker, preventing other workers from picking up the same job. However, this lock can be deleted, and such a deletion may not be detected until the worker tries to move the job to a completed or failed status.

A lock can be deleted for several reasons, the most common being::

* The worker is consuming too much CPU and has no time to renew the lock every 30 seconds (which is the default expiration time for locks)
* The worker has lost communication with Redis and cannot renew the lock in time.
* The job has been forcefully removed using one of BullMQ's APIs to remove jobs (or by removing the entire queue).
* The Redis instance has a wrong [maxmemory](https://docs.bullmq.io/guide/going-to-production#max-memory-policy) policy; it should be no-eviction to avoid Redis removing keys with the expiration date before hand.

