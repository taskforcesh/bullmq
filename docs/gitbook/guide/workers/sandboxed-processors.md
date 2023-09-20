---
description: Running jobs in isolated processes
---

# Sandboxed processors

It is also possible to define workers to run on a separate process, we call these processors for sandboxed because they run isolated from the rest of the code.

When your workers perform CPU-heavy operations, they will inevitably keep the NodeJS event loop busy, which prevents BullMQ from doing some job bookkeeping such as extending the job locks, which ultimately leads to "stalled" jobs.

Since these workers run the processor in a different process than the bookkeeping code, they will not result in stalled jobs as easily as standard workers. Make sure that you keep your concurrency factor within sane numbers for this not to happen

In order to use a sandboxed processor just define the processor in a separate file:

```typescript
import { SandboxedJob } from 'bullmq';

module.exports = async (job: SandboxedJob) => {
    // Do something with job
};
```

and refer to it in the worker constructor:

```typescript
import { Worker } from 'bullmq'

const processorFile = path.join(__dirname, 'my_procesor.js');
worker = new Worker(queueName, processorFile);
```

If you are looking for a tutorial with code examples on how to use sandboxed processors using typescript you can find one [here](https://blog.taskforce.sh/using-typescript-with-bullmq/).

### Worker Threads

The default mechanism for launching sandboxed workers is using Node's spawn process library. From BullMQ version v3.13.0, it is also possible to launch the workers using Node's new Worker Threads library. These threads are supposed to be less resource-demanding than the previous approach, however, they are still not as lightweight as we could expect since Nodes runtime needs to be duplicated by every thread.

In order to enable worker threads support just use the "`useWorkerThreads`" option when defining an external processor file:

```typescript
import { Worker } from 'bullmq'

const processorFile = path.join(__dirname, 'my_procesor.js');
worker = new Worker(queueName, processorFile, { useWorkerThreads: true });
```



