# Sandboxed processors

It is also possible to define workers to run on a separate process, we call this processors for sandboxed, because they run isolated from the rest of the code. 

Since these workers run the processor in a different process, they will not result in stalled jobs as easily as standard workers, although it is not completely impossible if the CPUs in the system are so overload that there is no practical time for the worker to perform its bookkeeping to avoid stalling.

In order to use a sandboxed processor just define the processor in a separate file:

```typescript
import { Job } from 'bullmq';

module.exports = async (job: Job) {
    // Do something with job
};
```

and refer to it in the worker constructor:

```typescript
const processorFile = path.join(__dirname, 'my_procesor.js');
worker = new Worker(queueName, processorFile);
```



