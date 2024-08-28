# Timeout

Sometimes, it is useful to timeout a processor function but you should be aware that async processes are not going to be cancelled immediately, even if you timeout a process, you need to validate that your process is in a cancelled state:

```typescript
import { AbortController } from 'node-abort-controller';

enum Step {
  Initial,
  Second,
  Finish,
}

const worker = new Worker(
  'queueName',
  async job => {
    let { step, timeout } = job.data;

    const abortController = new AbortController();

    const timeoutCall = setTimeout(() => {
      abortController.abort();
    }, timeout);
    abortController.signal.addEventListener(
      'abort',
      () => clearTimeout(timeoutCall),
      { once: true },
    );
    while (step !== Step.Finish) {
      switch (step) {
        case Step.Initial: {
          if (abortController.signal.aborted) {
            throw new Error('Timeout');
          }
          await doInitialStepStuff(1000);
          await job.updateData({
            step: Step.Second,
            timeout,
          });
          step = Step.Second;
          break;
        }
        case Step.Second: {
          await doSecondStepStuff();
          if (abortController.signal.aborted) {
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
      abortController.abort();
    }
  },
  { connection },
);
```

{% hint style="info" %}
It's better to split a long process into little functions/steps to be able to stop an execution by validating if we reach the timeout in each transition using an AbortController instance.
{% endhint %}

## Read more:

- 📋 [Process Step jobs](./process-step-jobs.md)
- 📋 [Cancellation by using Observables](../bullmq-pro/observables/cancelation.md)
