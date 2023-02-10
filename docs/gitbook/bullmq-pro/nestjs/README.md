There is a compatible module to be used in [NestJs](https://github.com/nestjs/nest) based on [@nestjs/bullmq](https://www.npmjs.com/package/@nestjs/bullmq).

```bash
yarn add @taskforcesh/nestjs-bullmq-pro
```

{% hint style="info" %}
BullMQ-Pro needs a token, please review [install](https://docs.bullmq.io/bullmq-pro/install) section.
{% endhint %}

Once the installation process is complete, we can import the **BullModule** into the root **AppModule**.

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@taskforcesh/nestjs-bullmq-pro';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: 'localhost',
        port: 6379,
      },
    }),
  ],
})
export class AppModule {}
```

To register a queue, import the **BullModule.registerQueue()** dynamic module, as follows:

```typescript
BullModule.registerQueue({
  name: 'queueName',
});
```

To register a flow producer, import the **BullModule.registerFlowProducer()** dynamic module, as follows:

```typescript
BullModule.registerFlowProducer({
  name: 'flowProducerName',
});
```

# Processor

To register a processor, you may need to use **Processor** decorator:

```typescript
import {
  Processor,
  WorkerHost,
  OnWorkerEvent,
} from '@taskforcesh/nestjs-bullmq-pro';
import { JobPro } from 'taskforcesh/bullmq-pro';

@Processor('queueName')
class TestProcessor extends WorkerHost {
  async process(job: JobPro<any, any, string>): Promise<any> {
    // do some stuff
  }

  @OnWorkerEvent('completed')
  onCompleted() {
    // do some stuff
  }
}
```

And then register it as a provider:

```typescript
@Module({
  imports: [
    BullModule.registerQueue({
      name: 'queueName',
      connection: {
        host: '0.0.0.0',
        port: 6380,
      },
    }),
    BullModule.registerFlowProducer({
      name: 'flowProducerName',
      connection: {
        host: '0.0.0.0',
        port: 6380,
      },
    }),
  ],
  providers: [TestProcessor],
})
export class AppModule {}
```

# Example

A working example is available [here](https://github.com/taskforcesh/nestjs-bullmq-pro-example).

## Read more:

- 💡 [Queues Technique](https://docs.nestjs.com/techniques/queues)
- 💡 [Register Queue API Reference](https://nestjs.bullmq.pro/classes/BullModule.html#registerQueue)
- 💡 [Register Flow Producer API Reference](https://nestjs.bullmq.pro/classes/BullModule.html#registerFlowProducer)
