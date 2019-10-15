<div align="center">
  <br/>
  <img src="https://user-images.githubusercontent.com/95200/64285204-99c04900-cf5b-11e9-925c-4743006ce420.png" width="300" />
  <br/>
  <br/>
  <p>
    The fastest, most reliable, Redis-based distributed queue for Node. <br/>
    Carefully written for rock solid stability and atomicity.
  </p>
  Read the <a href="https://docs.bullmq.io">documentation</a>
  <br/>
  <br/>
  <p>
    <a href="https://gitter.im/OptimalBits/bull">
      <img src="https://badges.gitter.im/Join%20Chat.svg"/>
    </a>
    <a href="https://travis-ci.org/taskforcesh/bullmq">
      <img src="https://img.shields.io/travis/OptimalBits/bull/master.svg"/>
    </a>
    <a href="https://badge.fury.io/js/bullmq">
      <img src="https://badge.fury.io/js/bullmq.svg"/>
    </a>
    <a href="https://coveralls.io/github/taskforcesh/bullmq?branch=master">
      <img src="https://coveralls.io/repos/github/taskforcesh/bullmq/badge.svg?branch=master"/>
    </a>
  </p>
  <p>
    <em>Follow <a href="https://twitter.com/manast">@manast</a> for Bull news and updates!</em>
  </p>
</div>

# The gist

Install:

```
$ yarn add bullmq
```

Add jobs to the queue:

```ts
import { Queue } from 'bullmq';

const queue = new Queue('Paint');

queue.add('cars', { color: 'blue' });
```

Process the jobs in your workers:

```ts
import { Worker } from 'bullmq';

const worker = new Worker('Paint', async job => {
  if (job.name === 'cars') {
    await paintCar(job.data.color);
  }
});
```

Listen to jobs for completion:

```ts
import { QueueEvents } from 'bullmq';

const queueEvents = new QueueEvents('Paint');

queueEvents.on('completed', jobId => {
  console.log('done painting');
});

queueEvents.on('failed', (jobId, err) => {
  console.error('error painting', err);
});
```

This is just scratching the surface, check all the features and more in the official <a href="https://docs.bullmq.io">documentation</a>

# Thanks

Thanks for all the contributors that made this library possible,
also a special mention to Leon van Kammen that kindly donated
his npm bullmq repo.
