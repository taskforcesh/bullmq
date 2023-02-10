There is a compatible module to be used in [NestJs](https://github.com/nestjs/nest).

```bash
npm i @nestjs/bullmq
```

Once the installation process is complete, we can import the **BullModule** into the root **AppModule**.

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

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
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';

@Processor('queueName')
class TestProcessor extends WorkerHost {
  async process(job: Job<any, any, string>): Promise<any> {
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

## Read more:

- 💡 [Queues Technique](https://docs.nestjs.com/techniques/queues)
