# Queue Events Listeners

To register a `QueueEvents` instance, you need to use `QueueEventsListener` decorator:

```typescript
import {
  QueueEventsListener,
  QueueEventsHost,
  OnQueueEvent,
} from '@taskforcesh/nestjs-bullmq-pro';
// Aliased because `QueueEventsListener` from '@taskforcesh/nestjs-bullmq-pro' is the decorator
import type { QueueEventsListener as QueueEventsListenerType } from 'bullmq';

// Use the generic to type the event payload with your job's return value
type CompletedEvent = QueueEventsListenerType<{ result: number }>['completed'];

type CompletedEventArgs = Parameters<CompletedEvent>[0];

@QueueEventsListener('queueName')
export class TestQueueEvents extends QueueEventsHost {
  @OnQueueEvent('completed')
  onCompleted({ jobId, returnvalue }: CompletedEventArgs) {
    // returnvalue is typed as { result: number }
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
  ],
  providers: [TestQueueEvents],
})
export class AppModule {}
```

## Read more:

- 💡 [Queues Technique](https://docs.nestjs.com/techniques/queues)
- 💡 [Register Queue API Reference](https://nestjs.bullmq.pro/classes/BullModule.html#registerQueue)
- 💡 [Queue Events Pro Listener API Reference](https://api.bullmq.pro/interfaces/v7.QueueEventsListenerPro.html)
