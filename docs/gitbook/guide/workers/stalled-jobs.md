# Stalled Jobs

Due to the nature of NodeJS, which is \(in general\) single threaded and consists of an event loop to handle the asynchronous operations, the process function needs to be written carefully so that the CPU is not occupied for a long time.

When a job reaches a worker and starts to be processed, BullMQ will place a lock on this job to protect the job from being modified by any other client or worker. At the same time, the worker needs to periodically notify BullMQ that it is still working on the job.

{% hint style="info" %}
This period is configured with the `stalledInterval` setting, which normally you should not need to modify.
{% endhint %}

However if the CPU is very busy (due to the process being very CPU intensive), the worker may not have time to renew the lock and tell the queue that it is still working on the job, which is likely to result in the job being marked as _stalled_.

A stalled job is moved back to the waiting status and will be processed again by another worker, or if it has reached its maximum number of stalls, it will be moved to the _failed_ set.

Therefore, it is very important to make sure the workers return control to the NodeJS event loop often enough to avoid this kind of problem.

