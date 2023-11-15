# Timeout

Sometimes, it is useful to timeout a processor function but you should be aware that async processes are not going to be cancelled immediately, even if you timeout a process, you need to validate that your process is in a cancelled state:

```typescript
enum Step {
  Initial,
  Second,
  Finish,
}

const worker = new Worker(
  'queueName',
  async job => {
    let { step, timeout } = job.data;
    let timeoutReached = false;

    setTimeout(() => {
      timeoutReached = true;
    }, timeout);
    while (step !== Step.Finish) {
      switch (step) {
        case Step.Initial: {
          await doInitialStepStuff(1000);
          if (timeoutReached) {
            throw new Error('Timeout');
          }
          await job.updateData({
            step: Step.Second,
            timeout,
          });
          step = Step.Second;
          break;
        }
        case Step.Second: {
          await doSecondStepStuff();
          if (timeoutReached) {
            throw new Error('Timeout');
          }
          await job.updateData({
            step: Step.Finish,
            timeout,
          });
          step = Step.Finish;
          return Step.Finish;
        }
        default: {
          throw new Error('invalid step');
        }
      }
    }
  },
  { connection },
);
```

{% hint style="info" %}
It's better to split a long process into little functions/steps to be able to stop an execution by validating if we reach the timeout in each transition.
{% endhint %}

## Read more:

- 📋 [Process Step jobs](./process-step-jobs.md)
- 📋 [Cancellation by using Observables](../bullmq-pro/observables/cancelation.md)