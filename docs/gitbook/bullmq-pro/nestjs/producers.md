Job producers add jobs to queues. Producers are typically application services (Nest providers). To add jobs to a queue, first inject the queue into the service as follows:

```typescript
import { Injectable } from '@nestjs/common';
import { QueuePro } from 'taskforcesh/bullmq-pro';
import { InjectQueue } from '@taskforcesh/nestjs-bullmq-pro';

@Injectable()
export class AudioService {
  constructor(@InjectQueue('audio') private audioQueue: QueuePro) {}
}
```

{% hint style="info" %}
The **@InjectQueue()** decorator identifies the queue by its name, as provided in the **registerQueue()**.
{% endhint %}

Now, add a job by calling the queue's add() method.

```typescript
const job = await this.audioQueue.add({
  foo: 'bar',
});
```

# Flow Producers

To add flows, first inject the flow producer into the service as follows:

```typescript
import { Injectable } from '@nestjs/common';
import { FlowProducerPro } from 'taskforcesh/bullmq-pro';
import { InjectFlowProducer } from '@taskforcesh/nestjs-bullmq-pro';

@Injectable()
export class FlowService {
  constructor(@InjectFlowProducer('flow') private fooFlowProducer: FlowProducerPro) {}
}
```

{% hint style="info" %}
The **@InjectFlowProducer()** decorator identifies the flow producer by its name, as provided in the **registerFlowProducer()**.
{% endhint %}

Now, add a flow by calling the flow producer's add() method.

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
        ]
      });
```

## Read more:

- 💡 [Queues Technique](https://docs.nestjs.com/techniques/queues)
- 💡 [Inject Queue API Reference](https://nestjs.bullmq.pro/functions/InjectQueue.html)
- 💡 [Inject Flow Producer API Reference](https://nestjs.bullmq.pro/functions/InjectFlowProducer.html)
- 💡 [QueuePro API Reference](https://api.bullmq.pro/classes/Queue.html)
- 💡 [FlowProducerPro API Reference](https://api.bullmq.pro/classes/FlowProducer.html)
