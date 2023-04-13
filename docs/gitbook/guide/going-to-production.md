# Going to production

In this chapter, we will offer crucial considerations and tips to help you achieve a robust solution when deploying your BullMQ-based application to production.

### Persistence

Since BullMQ is based on Redis, persistence needs to be configured manually. Many hosting solutions do not offer persistence by default, instead, it needs to be configured per instance. We recommend enabling Append-only-file, which provides a robust and fast solution, usually, 1 second per write is enough for most applications: [https://redis.io/docs/management/persistence/#aof-advantages](https://redis.io/docs/management/persistence/#aof-advantages).

Even though persistence is very fast, it will have some effect on performance, so please make the proper benchmarks to know that it is not impacting your solution in a way that is not acceptable to you.

### Max memory policy

Redis is used quite often as a cache, meaning that it will remove keys according to some defined policy when it reaches several levels of memory consumption. BullMQ on the other hand cannot work properly if Redis evicts keys arbitrarily. Therefore is very important to configure the `maxmemory` setting to `noeviction`. This is the **only** setting that guarantees the correct behavior of the queues.

### Automatic reconnections

In a production setting, one of the things that are crucial for system robustness is to be able to recover automatically after connection issues. It is impossible to guarantee that a connection between BullMQ and Redis will always stay online. However, the important thing is that it recovers as fast as possible when the connection can be re-established without any human intervention.

In order to understand how to properly handle disconnections it is important to understand some options provided by [IORedis](https://www.npmjs.com/package/ioredis#Auto-reconnect). The ones interesting for us are:

* retryStrategy
* maxRetriesPerRequest
* enableOfflineQueue

It is also important to understand the difference in behavior that is often desired for Queue and Worker classes. Normally the operations performed using the Queue class should [fail quickly](../patterns/failing-fast-when-redis-is-down.md) if there is a temporal disconnection, whereas for Workers we want to wait indefinitely without raising any exception.

#### retryStrategy

This option is used to determine the function used to perform retries. The retries will keep forever until the reconnection has been accomplished. For IORedis connections created inside BullMQ we use the following strategy:

```ts
 retryStrategy: function (times: number) {
    return Math.max(Math.min(Math.exp(times), 20000), 1000);
 }
```

In other words, it will retry using exponential backoff, with a minimum 1-second retry time and max of 20 seconds. This retryStrategy can easily be overridden by passing a custom one defining custom IORedis options.

#### maxRetriesPerRequest

This option sets a limit on the number of times a retry on a failed request will be performed. For Workers, it is important to set this option to **null**. Otherwise, the exceptions raised by Redis when calling certain commands could break the worker functionality. When instantiating a Worker this option will always be set to null by default, but it could be overridden, either if passing an existing IORedis instance or by passing a different value for this option when instantiating the Worker. In both cases BullMQ will output a warning, please make sure to address this warning as it can have several unintended consequences.

#### enableOfflineQueue

IORedis provides a small offline queue that is used to queue commands while the connection is offline. You will probably want to disable this queue for the Queue instance, but leave it as is for Worker instances. That will make the Queue calls [fail quickly](../patterns/failing-fast-when-redis-is-down.md) while leaving the Workers to wait as needed until the connection has been re-established.

### Log errors

It is really useful to attach a handler for the error event which will be triggered when there are connection issues, this will be helpful when debugging your queues and prevent "unhandled errors".&#x20;

```typescript
worker.on("error", (err) => {
  // Log your error.
})
```

```typescript
queue.on("error", (err) => {
  // Log your error.
})
```

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

### Unhandled exceptions and rejections

Another common issue, especially in production environments, is the fact that NodeJS by default will break if there are unhandled exceptions. This is not unique for BullMQ-based applications, but a general rule for all NodeJS applications. We recommend that somewhere in your service you make sure that you handle the unhandled exceptions gracefully, and so you can fix them when they arise without any risk of the application breaking when they happen:

```typescript
process.on("uncaughtException", function (err) {
  // Handle the error safely
  logger.error(err, "Uncaught exception");
});

process.on("unhandledRejection", (reason, promise) => {
  // Handle the error safely
  logger.error({ promise, reason }, "Unhandled Rejection at: Promise");
});

```



