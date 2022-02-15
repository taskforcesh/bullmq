# Process Step jobs

Sometimes, it is useful to break processor function into small pieces that will be processed depending on the previous executed step, we could handle this kind of logic by using switch blocks:

```typescript
enum Step {
  Initial,
  Second,
  Finish,
}

const worker = new Worker(
  queueName,
  async job => {
    let step = job.data.step;
    while (step !== Step.Finish) {
      switch (step) {
        case Step.Initial: {
          await doInitialStepStuff();
          await job.update({
            step: Step.Second,
          });
          step = Step.Second;
          break;
        }
        case Step.Second: {
          await doSecondStepStuff();
          await job.update({
            step: Step.Finish,
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

As you can see, we should save the step value; in this case, we are saving it into the job's data. So even in the case of an error, it would be retried in the last step that was saved (in case we use a backoff strategy).

# Waiting Children

A common use case is to add children at runtime and then wait for the children to complete.

This could be handled using the moveToWaitingChildren method:

```typescript
enum Step {
  Initial,
  Second,
  Third,
  Finish,
}

const worker = new Worker(
  parentQueueName,
  async (job, token) => {
    let step = job.data.step;
    while (step !== Step.Finish) {
      switch (step) {
        case Step.Initial: {
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
            step: Step.Second,
          });
          step = Step.Second;
          break;
        }
        case Step.Second: {
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
            step: Step.Third,
          });
          step = Step.Third;
          break;
        }
        case Step.Third: {
          const shouldWait = await job.moveToWaitingChildren(token);
          if (!shouldWait) {
            await job.update({
              step: Step.Finish,
            });
            step = Step.Finish;
            return Step.Finish;
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
