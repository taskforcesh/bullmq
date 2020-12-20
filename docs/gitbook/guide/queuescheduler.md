# QueueScheduler

The QueueScheduler is a helper class used to manage stalled and delayed jobs for a given Queue.

```typescript
import { QueueScheduler } from 'bullmq'
  
const queueScheduler = new QueueScheduler('test');

// Later when shuting down gracefulle
await queueScheduler.close();

```

This class automatically moves delayed jobs back to the waiting queue when it is the right time to process them. It also automatically checks for stalled jobs, i.e., detects jobs that are active but where the worker has either crashed or stopped working properly. [Stalled jobs](jobs/stalled.md) are moved back or failed depending on the settings selected when instantiating the class.

{% hint style="info" %}
You need at least one QueueScheduler running somewhere for a given queue if you requiere functionality such as delayed jobs, retries with backoff and rate limiting.
{% endhint %}

The reason for having this functionality in a separate class instead of in the workers \(as in Bull 3.x\) is because whereas you may want to have a large number of workers for parallel processing, for the scheduler you probably only want a couple of instances for each queue that requires delayed or stalled checks. One will be enough but you can have more just for redundancy.

{% hint style="warning" %}
It is ok to have as many QueueScheduler instances as you want, just keep in mind that every instance will perform some bookkeeping so it may create some noticeable CPU and IO usage in your Redis instances.
{% endhint %}

