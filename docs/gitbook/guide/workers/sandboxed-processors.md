---
description: Running jobs in isolated processes
---

# Sandboxed processors

It is also possible to define workers to run on a separate process. We call these processors _sandboxed_, because they run isolated from the rest of the code.

When your workers perform CPU-heavy operations, they will inevitably keep the NodeJS event loop busy, which prevents BullMQ from doing job bookkeeping such as extending job locks, ultimately leading to "stalled" jobs.

Since _sandboxed_ workers run the processor in a different process than the bookkeeping code, they will not result in stalled jobs as easily as standard workers. Make sure that you keep your concurrency factor within sane numbers for this not to happen.

In order to use a sandboxed processor, define the processor in a separate file:

```typescript
import { SandboxedJob } from 'bullmq';

module.exports = async (job: SandboxedJob) => {
    // Do something with job
};
```

and pass its path to the worker constructor:

```typescript
import { Worker } from 'bullmq'

const processorFile = path.join(__dirname, 'my_procesor.js');
worker = new Worker(queueName, processorFile);
```

A tutorial with code examples on how to use sandboxed processors using Typescript can be found [here](https://blog.taskforce.sh/using-typescript-with-bullmq/).

### URL Support

Processors can be defined using URL instances:

```typescript
import { pathToFileURL } from 'url';

const processorUrl = pathToFileURL(__dirname + '/my_procesor.js');

worker = new Worker(queueName, processorUrl);
```

{% hint style="warning" %}
Recommended for Windows OS.
{% endhint %}

### Worker Threads

The default mechanism for launching sandboxed workers is using Node's spawn process library. From BullMQ version v3.13.0, it is also possible to launch the workers using Node's new Worker Threads library. These threads are supposed to be less resource-demanding than the previous approach, however, they are still not as lightweight as we could expect since Node's runtime needs to be duplicated by every thread.

In order to enable worker threads support use the `useWorkerThreads` option when defining an external processor file:

```typescript
import { Worker } from 'bullmq'

const processorFile = path.join(__dirname, 'my_procesor.js');
worker = new Worker(queueName, processorFile, { useWorkerThreads: true });
```

## Read more:

* 💡 [Worker API Reference](https://api.docs.bullmq.io/classes/v5.Worker.html)
