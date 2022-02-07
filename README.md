<div align="center">
  <br/>
  <img src="https://user-images.githubusercontent.com/95200/143832033-32e868df-f3b0-4251-97fb-c64809a43d36.png" width="800" />
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
    <a href="https://github.com/semantic-release/semantic-release">
      <img src="https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg"/>
    </a>
  </p>
  <p>
    <em>Follow <a href="https://twitter.com/manast">@manast</a> for *important* Bull/BullMQ news and updates!</em>
  </p>
</div>

# 🛠 Tutorials

You can find tutorials and news in this blog: https://blog.taskforce.sh/

# Official FrontEnd

[<img src="http://taskforce.sh/assets/logo_square.png" width="200" alt="Taskforce.sh, Inc" style="padding: 200px"/>](https://taskforce.sh)

Supercharge your queues with a professional front end:

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

queueEvents.on('completed', ({ jobId }) => {
  console.log('done painting');
});

queueEvents.on('failed', ({ jobId: string, failedReason: string }) => {
  console.error('error painting', failedReason);
});
```

This is just scratching the surface, check all the features and more in the official <a href="https://docs.bullmq.io">documentation</a>

# Feature Comparison

Since there are a few job queue solutions, here is a table comparing them:

| Feature                   |   Bullmq-Pro    |     Bullmq      |      Bull       |  Kue  | Bee      | Agenda |
| :------------------------ | :-------------: | :-------------: | :-------------: | :---: | -------- | ------ |
| Backend                   |      redis      |      redis      |      redis      | redis | redis    | mongo  |
| Observables               |        ✓        |                 |                 |       |          |        |
| Group Rate Limit          |        ✓        |                 |                 |       |          |        |
| Group Support             |        ✓        |                 |                 |       |          |        |
| Parent/Child Dependencies |        ✓        |        ✓        |                 |       |          |        |
| Priorities                |        ✓        |        ✓        |        ✓        |   ✓   |          | ✓      |
| Concurrency               |        ✓        |        ✓        |        ✓        |   ✓   | ✓        | ✓      |
| Delayed jobs              |        ✓        |        ✓        |        ✓        |   ✓   |          | ✓      |
| Global events             |        ✓        |        ✓        |        ✓        |   ✓   |          |        |
| Rate Limiter              |        ✓        |        ✓        |        ✓        |       |          |        |
| Pause/Resume              |        ✓        |        ✓        |        ✓        |   ✓   |          |        |
| Sandboxed worker          |        ✓        |        ✓        |        ✓        |       |          |        |
| Repeatable jobs           |        ✓        |        ✓        |        ✓        |       |          | ✓      |
| Atomic ops                |        ✓        |        ✓        |        ✓        |       | ✓        |        |
| Persistence               |        ✓        |        ✓        |        ✓        |   ✓   | ✓        | ✓      |
| UI                        |        ✓        |        ✓        |        ✓        |   ✓   |          | ✓      |
| Optimized for             | Jobs / Messages | Jobs / Messages | Jobs / Messages | Jobs  | Messages | Jobs   |

# 🚀 Sponsor 🚀

[![RedisGreen](https://www.redisgreen.com/images/rglogo/redisgreen_transparent_240x48.png)](https://dashboard.redisgreen.net/new?utm_campaign=BULLMQ)

If you need high quality production Redis instances for your BullMQ project, please consider subscribing to [RedisGreen](https://dashboard.redisgreen.net/new?utm_campaign=BULLMQ), leaders in Redis hosting that works perfectly with BullMQ. Use the promo code "BULLMQ" when signing up to help us sponsor the development of BullMQ!

## Contributing

Fork the repo, make some changes, submit a pull-request! Here is the [contributing](contributing.md) doc that has more details.

# Thanks

Thanks for all the contributors that made this library possible,
also a special mention to Leon van Kammen that kindly donated
his npm bullmq repo.
