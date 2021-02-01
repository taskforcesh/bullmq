# Idempotent jobs

In order to take advantage from [the ability to retry failed jobs](../guide/retrying-failing-jobs.md), your jobs should be designed with failure in mind.

This means that it should not make a difference to the final state of the system if a job can be finished in the first attempt or if it fails and needs to be retried later. This is called _Idempotence_.

To achieve this behaviour, your jobs should be as atomic and simple as possible. Performing many different actions \(such as database updates, API calls, ...\) at once makes it hard to keep track of the process flow and, if needed, rollback partial progress when an exception occurs.

Simpler jobs also means simpler debugging, identifying bottlenecks, etc.

If necessary, split complex jobs [as described in the flow pattern](flows.md).

