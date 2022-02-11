# Process Step jobs

Sometimes, it is useful to break processor function into small pieces that will be processed depending on the previous executed step, we could handle this kind of logic by using switch blocks:

```typescript
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

As you can see, we should save the step value; in this case, we are saving it into data. So even in the case of an error, it would be retried in the last step that was saved (in case we use a backoff strategy).

# Waiting Children

There is a case where people want to add children at runtime, then wait for children

This could be handled using moveToWaitingChildren method:

```typescript
const worker = new Worker(
  parentQueueName,
  async job => {
    const initialStep = 'initialStep';
    const secondStep = 'secondStep';
    const thirdStep = 'thirdStep';
    const finishStep = 'finishStep';
    let step = job.data.step;
    while (step !== finishStep) {
      switch (step) {
        case initialStep: {
          await doInitialStepStuff();
          await childrenQueue.add(
            'child-1',
            { foo: 'bar' },
            {
              parent: {
                id: job.id,
                queue: `bull:${parentQueueName}`,
              },
            },
          );
          await job.update({
            step: secondStep,
          });
          step = secondStep;
          break;
        }
        case secondStep: {
          await doSecondStepStuff();
          await childrenQueue.add(
            'child-2',
            { foo: 'bar' },
            {
              parent: {
                id: job.id,
                queue: `bull:${parentQueueName}`,
              },
            },
          );
          await job.update({
            step: thirdStep,
          });
          step = thirdStep;
          break;
        }
        case thirdStep: {
          const shouldWait = await job.moveToWaitingChildren(token);
          if (!shouldWait) {
            await job.update({
              step: finishStep,
            });
            step = finishStep;
            return 'finished';
          }
          break;
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
Bullmq-Pro: this pattern could be handled by using observables; in that case, we do not need to save next step.
{% endhint %}
