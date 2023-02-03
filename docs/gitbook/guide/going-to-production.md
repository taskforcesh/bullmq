# Going to production

In this chapter, we will offer crucial considerations and tips to help you achieve a robust solution when deploying your BullMQ-based application to production.

### Persistence

Since BullMQ is based on Redis, persistence needs to be configured manually. Many hosting solutions do not offer persistence by default, instead, it needs to be configured per instance. We recommend enabling Append-only-file, which provides a robust and fast solution, usually, 1 second per write is enough for most applications: [https://redis.io/docs/management/persistence/#aof-advantages](https://redis.io/docs/management/persistence/#aof-advantages).

Even though persistence is very fast, it will have some effect on performance, so please make the proper benchmarks to know that it is not impacting your solution in a way that is not acceptable to you.

### Max memory policy

Redis is used quite often as a cache, meaning that it will remove keys according to some defined policy when it reaches several levels of memory consumption. BullMQ on the other hand cannot work properly if Redis evicts keys arbitrarily. Therefore is very important to configure the `maxmemory` setting to `noeviction`. This is the **only** setting that guarantees the correct behavior of the queues.

### Automatic reconnections



### Gracefully shut-down workers

Since your workers will run on servers, it is unavoidable that these servers will need to be restarted from time to time. As your workers may be processing jobs when the server is about to restart, it is important to properly close the workers to minimize the risk of stalled jobs. If a worker is killed without waiting for their jobs to complete, these jobs will be marked as stalled and processed automatically when new workers come online (with a waiting time of about 30 seconds by default). However it is better to avoid having stalled jobs, and as mentioned this can be done by closing the workers when the server is going to be restarted. In NodeJS you can accomplish this by listening to the SIGINT signal like this:

```typescript
process.on("SIGINT", async () => {
  await worker.close();
});
```

Keep in mind that the code above does not guarantee that the jobs will never end up being stalled, as the job may take longer time than the grace period for the server to restart.

### Auto-job removal

By default, all jobs processed by BullMQ will be either completed or failed and kept forever. This behavior is not usually the most desired, so you would like to configure a maximum number of jobs to keep. The most common configuration is to keep a handful of completed jobs, just to have some visibility of the latest completed, whereas you can keep either all of the failed jobs or a very large number in case you want to manually retry them or perform a deeper debugging study on the reason why the jobs failed.

You can read more about how to configure auto removal [here](https://docs.bullmq.io/guide/queues/auto-removal-of-jobs).

### Protecting data

Another important point to think about when deploying for production is the fact that the data field of the jobs is stored in clear text. The best is to avoid storing sensitive data in the job altogether., but if this is not possible, then it is highly recommended to encrypt the part of the data that is sensible before it is added to the queue.

Please do not take security lightly as it should be a major concern today, and the risks of losing data and economic damage to your business are real and very serious.





