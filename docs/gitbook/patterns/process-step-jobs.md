# Process Step jobs

Sometimes, people would like to break their processor function into small pieces that will be processed depending on the previous executed step, we could handle this kind of logic by using switch blocks:

```typescript
const queueScheduler = new QueueScheduler(queueName, {connection});

const worker = new Worker(
  queueName,
  async job => {
    const initialStep = 'initialStep';
    const secondStep = 'secondStep';
    const finishStep = 'finishStep';
    let step = job.data.step;
    while(step!==finishStep){
      switch(step){
        case initialStep:{
          await job.update({
            step: secondStep
          })
          step = secondStep
        }
        case secondStep:{
          if (job.attemptsMade < 3) {
            throw new Error('Not yet!');
          }
          await job.update({
            step: finishStep
          })
          step = finishStep
        }
        case finishStep:{
          return 'finished'
        }
        default: {
          throw new Error('invalid step');
        }
      }  
    }
  },
  { connection },
);
```

As you can see, we should save the step value, in this case we are saving it into data. So even in an error, it would be retried in the last step that was saved.
