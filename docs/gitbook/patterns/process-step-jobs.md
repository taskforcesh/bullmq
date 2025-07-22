# Process Step jobs

Sometimes, it is useful to break processor functions into small pieces that will be processed depending on the previous executed step. One way to handle this kind of logic is by using switch statements:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
enum Step {
  Initial,
  Second,
  Finish,
}

const worker = new Worker(
  'queueName',
  async job => {
    let step = job.data.step;
    while (step !== Step.Finish) {
      switch (step) {
        case Step.Initial: {
          await doInitialStepStuff();
          await job.updateData({
            step: Step.Second,
          });
          step = Step.Second;
          break;
        }
        case Step.Second: {
          await doSecondStepStuff();
          await job.updateData({
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

{% endtab %}

{% tab title="Python" %}

```python
class Step(int, Enum):
  Initial = 1
  Second = 2
  Finish = 3

async def process(job: Job, token: str):
  step = job.data.get("step")
  while step != Step.Finish:
    if step == Step.Initial:
      await doInitialStepStuff()
      await job.updateData({
          "step": Step.Second
      })
      step = Step.Second
    elif step == Step.Second:
      await doSecondStepStuff()
      await job.updateData({
          "step": Step.Finish
      })
      step = Step.Finish
    else:
      raise Exception("invalid step")

worker = Worker("queueName", process, {"connection": connection})
```

{% endtab %}
{% endtabs %}

By saving the next step value every time we complete the previous step (here, saving it in the job's data), we can ensure that if the job errors and retries, it does so starting from the correct step.

## Delaying

There are situations when it is useful to delay a job when it is being processed.

This can be handled using the `moveToDelayed` method. However, it is important to note that when a job is being processed by a worker, the worker keeps a lock on this job with a certain token value. For the `moveToDelayed` method to work, we need to pass said token so that it can unlock without error. Finally, we need to exit from the processor by throwing a special error (`DelayedError`) that will signal to the worker that the job has been delayed so that it does not try to complete (or fail the job) instead.

```typescript
import { DelayedError, Worker } from 'bullmq';

enum Step {
  Initial,
  Second,
  Finish,
}

const worker = new Worker(
  'queueName',
  async (job: Job, token?: string) => {
    let step = job.data.step;
    while (step !== Step.Finish) {
      switch (step) {
        case Step.Initial: {
          await doInitialStepStuff();
          await job.moveToDelayed(Date.now() + 200, token);
          await job.updateData({
            step: Step.Second,
          });
          throw new DelayedError();
        }
        case Step.Second: {
          await doSecondStepStuff();
          await job.updateData({
            step: Step.Finish,
          });
          step = Step.Finish;
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

## Waiting Children

A common use case is to add children at runtime and then wait for the children to complete.

This can be handled using the `moveToWaitingChildren` method. However, it is important to note that when a job is being processed by a worker, the worker keeps a lock on this job with a certain token value. For the `moveToWaitingChildren` method to work, we need to pass said token so that it can unlock without error. Finally, we need to exit from the processor by throwing a special error (`WaitingChildrenError`) that will signal to the worker that the job has been moved to _waiting-children_, so that it does not try to complete (or fail) the job instead.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { WaitingChildrenError, Worker } from 'bullmq';

enum Step {
  Initial,
  Second,
  Third,
  Finish,
}

const worker = new Worker(
  'parentQueueName',
  async (job: Job, token?: string) => {
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
                queue: job.queueQualifiedName,
              },
            },
          );
          await job.updateData({
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
                queue: job.queueQualifiedName,
              },
            },
          );
          await job.updateData({
            step: Step.Third,
          });
          step = Step.Third;
          break;
        }
        case Step.Third: {
          const shouldWait = await job.moveToWaitingChildren(token);
          if (!shouldWait) {
            await job.updateData({
              step: Step.Finish,
            });
            step = Step.Finish;
            return Step.Finish;
          } else {
            throw new WaitingChildrenError();
          }
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

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Worker, WaitingChildrenError
from enum import Enum

class Step(int, Enum):
  Initial = 1
  Second = 2
  Third = 3
  Finish = 4

async def process(job: Job, token: str):
  step = job.data.get("step")
  while step != Step.Finish:
    if step == Step.Initial:
      await doInitialStepStuff()
      await children_queue.add('child-1', {"foo": "bar" },{
        "parent": {
            "id": job.id,
            "queue": job.queueQualifiedName
        }
      })
      await job.updateData({
          "step": Step.Second
      })
      step = Step.Second
    elif step == Step.Second:
      await doSecondStepStuff()
      await children_queue.add('child-2', {"foo": "bar" },{
        "parent": {
          "id": job.id,
          "queue": job.queueQualifiedName
        }
      })
      await job.updateData({
          "step": Step.Third
      })
      step = Step.Third
    elif step == Step.Third:
      should_wait = await job.moveToWaitingChildren(token, {})
      if not should_wait:
        await job.updateData({
            "step": Step.Finish
        })
        step = Step.Finish
        return Step.Finish
      else:
        raise WaitingChildrenError
    else:
      raise Exception("invalid step")

worker = Worker("parentQueueName", process, {"connection": connection})
```

{% endtab %}
{% endtabs %}

{% hint style="info" %}
Bullmq-Pro: this pattern could be handled by using observables; in that case, we do not need to save next step.
{% endhint %}

## Chaining Flows

Another use case is to add flows at runtime and then wait for the children to complete.

For example, we can add children dynamically in the worker's processor function:

```typescript
import { FlowProducer, WaitingChildrenError, Worker } from 'bullmq';

enum Step {
  Initial,
  Second,
  Third,
  Finish,
}

const flow = new FlowProducer({ connection });
const worker = new Worker(
  'parentQueueName',
  async (job, token) => {
    let step = job.data.step;
    while (step !== Step.Finish) {
      switch (step) {
        case Step.Initial: {
          await doInitialStepStuff();
          await flow.add({
            name: 'child-job',
            queueName: 'childrenQueueName',
            data: {},
            children: [
              {
                name,
                data: { idx: 0, foo: 'bar' },
                queueName: 'grandchildrenQueueName',
              },
              {
                name,
                data: { idx: 1, foo: 'baz' },
                queueName: 'grandchildrenQueueName',
              },
            ],
            opts: {
              parent: {
                id: job.id,
                queue: job.queueQualifiedName,
              },
            },
          });

          await job.updateData({
            step: Step.Second,
          });
          step = Step.Second;
          break;
        }
        case Step.Second: {
          await doSecondStepStuff();
          await job.updateData({
            step: Step.Third,
          });
          step = Step.Third;
          break;
        }
        case Step.Third: {
          const shouldWait = await job.moveToWaitingChildren(token);
          if (!shouldWait) {
            await job.updateData({
              step: Step.Finish,
            });
            step = Step.Finish;
            return Step.Finish;
          } else {
            throw new WaitingChildrenError();
          }
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
Manually moving jobs using special errors does **not** increment the attemptsMade property. This property is incremented on regular job completion or failure (this includes retries using backoff a backoff strategy). To control how many times a job is allowed to skip an attempt made using one of our special errors like: **DelayedError**, **RateLimitError**, **WaitingChildrenError** or **WaitingError**, use the **maxSkippedAttemptCount** option within Worker instances.
{% endhint %}

## Read more:

- 💡 [Move To Delayed API Reference](https://api.docs.bullmq.io/classes/v5.Job.html#moveToDelayed)
- 💡 [Move To Waiting Children API Reference](https://api.docs.bullmq.io/classes/v5.Job.html#moveToWaitingChildren)
