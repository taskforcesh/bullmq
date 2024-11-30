# Failing fast when Redis is down

By design, BullMQ reconnects to Redis automatically. If jobs are added to a queue while the queue instance is disconnected from Redis, the `add` command will not fail; instead, the call will keep waiting for a reconnection to occur until it can complete.

This behavior is not always desirable; for example, if you have implemented a REST API that results in a call to `add`, you do not want to keep the HTTP call busy while `add` is waiting for the queue to reconnect to Redis. In this case, you can pass the option `enableOfflineQueue: false`, so that `ioredis` do not queue the commands and instead throws an exception:

```typescript
const myQueue = new Queue("transcoding", {
  connection: {
    enableOfflineQueue: false,
  },
});

app.post("/jobs", async (req, res) => {
  try {
    const job = await myQueue.add("myjob", { req.body });
    res.status(201).json(job.id);
  }catch(err){
    res.status(503).send(err);
  }
})
```

Using this approach, the caller can catch the exception and act upon it depending on its requirements (for example, retrying the call or giving up).

{% hint style="danger" %}
Currently, there is a limitation in that the Redis instance must at least be online while the queue is being instantiated.
{% endhint %}
