# Stalled Jobs

Due to the nature of NodeJS, which is \(in general\) single threaded and consists of an event loop to handle the asynchronous operations, the process function needs to be written carefully so that the CPU is not occupied for a long time.

When a job reaches a worker and starts to be processed, BullMQ will place a lock on this job to protect the job from being modified by any other client or worker. At the same time, the worker needs to periodically notify BullMQ that it is still working on the job.

{% hint style="info" %}
This period is configured with the "stalledInterval" setting, which normally you should not need to modify.
{% endhint %}

However if the CPU is very busy due to the process being very CPU intensive, the worker may not have time to renew the lock and tell the queue that it is still working on the job, then the job will likely be marked as Stalled.

A stalled job is moved back to the waiting status and will be processed again by another worker, or if it has reached its maximum number of stalls moved to the failed set.

Therefore it is very important to make sure the workers return the control to NodeJS event loop often enough to avoid this kind of problems.

