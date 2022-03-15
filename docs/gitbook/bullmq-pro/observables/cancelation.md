# Cancelation

As mentioned, Observables allows for clean cancelation. Currently we support a TTL value that defines the maximum processing time before the job is finally cancelled:

```typescript
import { WorkerPro } from "@taskforcesh/bullmq-pro"

const worker = new WorkerPro(queueName, processor, {
  ttl: 100,
  connection,
});
```
