# Manage Job Schedulers

In BullMQ, managing the lifecycle and inventory of job schedulers is crucial for maintaining efficient and organized background tasks. In addition to the upsertJobScheduler method—which allows for the addition and updating of job schedulers—two other methods play essential roles: removeJobScheduler and getJobSchedulers. These functions enable the removal of schedulers and retrieval of all existing schedulers, respectively, providing comprehensive control over your job scheduling environment.

#### Remove job scheduler

The removeJobScheduler method is designed to delete a specific job scheduler from the queue. This is particularly useful when a scheduled task is no longer needed or if you wish to clean up inactive or obsolete schedulers to optimize resource usage.

```typescript
// Remove a job scheduler with ID 'scheduler-123'
const result = await queue.removeJobScheduler('scheduler-123');
console.log(result ? 'Scheduler removed successfully' : 'Failed to remove scheduler');
```

#### Get Job Schedulers

The getJobSchedulers method retrieves a list of all configured job schedulers within a specified range. This is invaluable for monitoring and managing multiple job schedulers, especially in systems where jobs are dynamically scheduled and require frequent reviews or adjustments.

```typescript
// Retrieve the first 10 job schedulers in ascending order of their next execution time
const schedulers = await queue.getJobSchedulers(0, 9, true);
console.log('Current job schedulers:', schedulers);
```

This method can be particularly useful for generating reports or dashboards that provide insights into when jobs are scheduled to run, aiding in system monitoring and troubleshooting.

