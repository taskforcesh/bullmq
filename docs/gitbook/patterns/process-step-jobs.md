# Process Step jobs

Sometimes, it is useful to break processor function into small pieces that will be processed depending on the previous executed step, we could handle this kind of logic by using switch blocks:

```typescript
const queueScheduler = new QueueScheduler(queueName, { connection });

const worker = new Worker(
  queueName,
  async job => {
    const initialStep = 'initialStep';
    const secondStep = 'secondStep';
    const finishStep = 'finishStep';
    let step = job.data.step;
    while (step !== finishStep) {
      switch (step) {
        case initialStep: {
          await doInitialStepStuff();
          await job.update({
            step: secondStep,
          });
          step = secondStep;
          break;
        }
        case secondStep: {
          await doSecondStepStuff();
          await job.update({
            step: finishStep,
          });
          step = finishStep;
          return 'finished';
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

As you can see, we should save the step value, in this case we are saving it into data. So even in the case of an error, it would be retried in the last step that was saved (in case we use a backoff strategy).

{% hint style="info" %}
Bullmq-Pro: this pattern could be handle by using observables, in that case we do not need to save next step.
{% endhint %}
