# Failing fast when Redis is down

By design, BullMQ will reconnect automatically and if you add new jobs to a queue while the queue instance is disconnected from Redis, the add command will not fail, instead the call will keep waiting for a reconnection to occur until it can complete.&#x20;

This behavior is not always desirable, for example, if you have implemented a REST api that results in a call to "add", you do not want to keep the HTTP call busy while the "add" is waiting for the queue to reconnect to Redis. In this case you can just pass the option "enableOfflineQueue: false", so that "ioredis" do not queue the commands and instead throws an exception:

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

In this way the caller can catch this temporal error and act upon it, maybe doing some retries or giving up depending on its requirements.

{% hint style="danger" %}
Currently there is a limitation in that the Redis instance must at least be online while the queue is being instantiated.
{% endhint %}
