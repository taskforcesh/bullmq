# Cancellation

As mentioned, Observables allows for clean cancellation. Currently we support a TTL value that defines the maximum processing time before the job is finally cancelled:

```typescript
import { WorkerPro } from '@taskforcesh/bullmq-pro';

const worker = new WorkerPro(queueName, processor, {
  ttl: 100,
  connection,
});
```

This parameter allows to provide ttl values per job name too:

```typescript
const worker = new WorkerPro(queueName, processor, {
  ttl: { test1: 100, test2: 200 },
  connection,
});
```
