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
    <a href="https://openbase.com/js/bullmq?utm_source=embedded&utm_medium=badge&utm_campaign=rate-badge">
      <img src="https://badges.openbase.com/js/rating/bullmq.svg"/>
    </a>
    <a href="https://gitter.im/OptimalBits/bull">
      <img src="https://badges.gitter.im/Join%20Chat.svg"/>
    </a>    
    <a href="https://badge.fury.io/js/bullmq">
      <img src="https://badge.fury.io/js/bullmq.svg"/>
    </a>
    <a href="https://coveralls.io/github/taskforcesh/bullmq?branch=master">
      <img src="https://coveralls.io/repos/github/taskforcesh/bullmq/badge.svg?branch=master"/>
    </a>
  </p>
  <p>
    <em>Follow <a href="https://twitter.com/manast">@manast</a> for *important* Bull/BullMQ news and updates!</em>
  </p>
</div>

# 🙏 I Need your help!

I need you to spend 15 seconds to complete this [survey](https://docs.google.com/forms/d/e/1FAIpQLScpD5z9gdsjOwkgjV6XsLV0_paFZt-KYyJtL1r1DrI-yQVWww/viewform?usp=sf_link)

Thanks!

# 🛠 Tutorials

You can find tutorials and news in this blog: https://blog.taskforce.sh/

# Official FrontEnd

[<img src="http://taskforce.sh/assets/logo_square.png" width="200" alt="Taskforce.sh, Inc" style="padding: 200px"/>](https://taskforce.sh)

Supercharge your queues with a profesional front end:
- Get a complete overview of all your queues.
- Inspect jobs, search, retry, or promote delayed jobs.
- Metrics and statistics.
- and many more features.

Sign up at [Taskforce.sh](https://taskforce.sh)

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

# 🚀 Sponsor 🚀

[![RedisGreen](https://www.redisgreen.com/images/rglogo/redisgreen_transparent_240x48.png)](https://dashboard.redisgreen.net/new?utm_campaign=BULLMQ)

If you need high quality production Redis instances for your BullMQ project, please consider subscribing 
to [RedisGreen](https://dashboard.redisgreen.net/new?utm_campaign=BULLMQ), 
leaders in Redis hosting that works perfectly with BullMQ. Use the promo code "BULLMQ" when signing up to help us
sponsor the development of BullMQ!

# Thanks

Thanks for all the contributors that made this library possible,
also a special mention to Leon van Kammen that kindly donated
his npm bullmq repo.
