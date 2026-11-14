# Producers

Job producers add jobs to queues. Producers are typically application services (Nest providers). To add jobs to a queue, first inject the queue into the service as follows:

```typescript
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class AudioService {
  constructor(@InjectQueue('audio') private audioQueue: Queue) {}
}
```

> **Note:** The **`@InjectQueue()`** decorator identifies the queue by its name, as provided in the **`registerQueue()`**.

Now, add a job by calling the queue's add() method.

```typescript
const job = await this.audioQueue.add('sample', {
  foo: 'bar',
});
```

## Flow Producers

To add flows, first inject the flow producer into the service as follows:

```typescript
import { Injectable } from '@nestjs/common';
import { InjectFlowProducer } from '@nestjs/bullmq';
import { FlowProducer } from 'bullmq';

@Injectable()
export class FlowService {
  constructor(
    @InjectFlowProducer('flow') private fooFlowProducer: FlowProducer,
  ) {}
}
```

> **Note:** The **`@InjectFlowProducer()`** decorator identifies the flow producer by its `name`, as provided in the **`registerFlowProducer()`**.

Now, add a flow by calling the flow producer's `add()`` method.

```typescript
const job = await this.fooFlowProducer.add({
  name: 'root-job',
  queueName: 'topQueueName',
  data: {},
  children: [
    {
      name,
      data: { idx: 0, foo: 'bar' },
      queueName: 'childrenQueueName',
    },
  ],
});
```

### Read more:

* 💡 [Queues Technique](https://docs.nestjs.com/techniques/queues)
