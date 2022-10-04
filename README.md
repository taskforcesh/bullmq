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

# Used by

Some notable organizations using BullMQ:

<table cellspacing="0" cellpadding="0">
  <tr>
    <td valign="center">
       <a href="https://github.com/microsoft/lage">
        <img
          src="https://files.gitbook.com/v0/b/gitbook-x-prod.appspot.com/o/spaces%2F-LUuDmt_xXMfG66Rn1GA%2Fuploads%2FUvwInTAmk7hxAViDwJzU%2Fclipart1565701.png?alt=media"
          width="150"
          alt="Microsoft"
        />
       </a>
    </td>
    <td valign="center">
       <a href="https://github.com/vendure-ecommerce/vendure">
        <img
          src="https://files.gitbook.com/v0/b/gitbook-x-prod.appspot.com/o/spaces%2F-LUuDmt_xXMfG66Rn1GA%2Fuploads%2FvT30DUqsi61gL8edn3R2%2Fwordmark-logo.png?alt=media"
          width="150"
          alt="Vendure"
        />
       </a>
    </td>
        <td valign="center">
       <a href="https://github.com/datawrapper/datawrapper">
        <img
          src="https://files.gitbook.com/v0/b/gitbook-x-prod.appspot.com/o/spaces%2F-LUuDmt_xXMfG66Rn1GA%2Fuploads%2FCJ5XmotpBBsuSgD8CilC%2Fdatawrapper-logo.png?alt=media"
          width="150"
          alt="Datawrapper"
        />
       </a>
    </td>
    </tr>
    <tr>
      <td valign="center">
       <a href="https://github.com/teamcurri">
        <img
          src="https://user-images.githubusercontent.com/659829/161662129-ae645bc4-c1e9-48ff-997e-4cee281a964a.png"
          width="150"
          alt="Curri"
        />
      </a>
    </td>
      <td valign="center">
       <a href="https://novu.co">
        <img
          src="https://super-static-assets.s3.amazonaws.com/1e9f5a51-c4c6-4fca-b6e8-25fa0186f139/images/4052d2f1-dc73-4421-984c-cdd02e989fdb.png"
          width="150"
          alt="Curri"
        />
      </a>
    </td>
    </tr>
</table>



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

queueEvents.on('failed', ({ jobId, failedReason }: { jobId: string, failedReason: string }) => {
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

<a href="https://dashboard.memetria.com/new?utm_campaign=BULLMQ">
  <img src="https://www.memetria.com/images/logo/memetria-logo.svg" width=300 alt="Memetria for Redis" />
</a>

If you need high quality production Redis instances for your BullMQ project, please consider subscribing to [Memetria for Redis](https://dashboard.memetria.com/new?utm_campaign=BULLMQ), leaders in Redis hosting that works perfectly with BullMQ. Use the promo code "BULLMQ" when signing up to help us sponsor the development of BullMQ!

## Contributing

Fork the repo, make some changes, submit a pull-request! Here is the [contributing](contributing.md) doc that has more details.

# Thanks

Thanks for all the contributors that made this library possible,
also a special mention to Leon van Kammen that kindly donated
his npm bullmq repo.
