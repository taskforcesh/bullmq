# Named processor

When a Worker is instantiated, the most common usage is to specify a process function.

Sometimes however, it is useful to be able to specify more than one function to process a job for a specific condition:

```typescript
const worker = new Worker(
  'queueName',
  async job => {
    switch (job.name) {
      case 'taskType1': {
        await doSomeLogic1();
        break;
      }
      case 'taskType2': {
        await doSomeLogic2();
        break;
      }
    }
  },
  { connection },
);
```

You could use a simple switch case to differentiate your logic, in this example we are using the job name.

{% hint style="warning" %}
This was a feature in the Bull package, but it creates a lot of confusion, so in order to provide an alternative, you can use this pattern. See [#297](https://github.com/taskforcesh/bullmq/issues/297) and [#69](https://github.com/taskforcesh/bullmq/issues/69) as reference
{% endhint %}
