
<div align="center">
  <br/>
  <img src="https://user-images.githubusercontent.com/95200/64285204-99c04900-cf5b-11e9-925c-4743006ce420.png
" width="300" />
  <br/>
  <br/>
  <p>
    The fastest, most reliable, Redis-based distributed queue for Node. <br/>
    Carefully written for rock solid stability and atomicity.
  </p>
  <br/>
  <br/>
  <p>
    <a href="https://gitter.im/OptimalBits/bull">
      <img src="https://badges.gitter.im/Join%20Chat.svg"/>
    </a>
    <a href="http://travis-ci.org/OptimalBits/bull">
      <img src="https://img.shields.io/travis/OptimalBits/bull/master.svg"/>
    </a>
    <a href="http://badge.fury.io/js/bull">
      <img src="https://badge.fury.io/js/bull.svg"/>
    </a>
    <a href="https://coveralls.io/github/OptimalBits/bull?branch=master">
      <img src="https://coveralls.io/repos/github/OptimalBits/bull/badge.svg?branch=master"/>
    </a>
  </p>
  <p>
    <em>Follow <a href="http://twitter.com/manast">@manast</a> for Bull news and updates!</em>
  </p>
</div>


Add jobs to the queue:
```ts
import { Queue } from 'bullmq'

const queue = new Queue('Paint');

queue.add('cars', { color: 'blue' });

```

Process the jobs in your workers:
```ts

import { Worker } from 'bullmq';

const worker = new Worker('Paint', (job) => {
    if(job.name === 'cars'){
       paintCar(job.data.color);
    }
});
```

Listen to jobs for completion:
```ts
import { QueueEvents } from 'bullmq';

const queueEvents = new QueueEvents('Pain');

queueEvents.on('completed', (jobId) => {
    console.log('done painting');
});

queueEvents.on('failed', (jobId, err) => {
    console.error('error painting', err);
});
```


