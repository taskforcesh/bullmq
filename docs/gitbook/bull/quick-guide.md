# Quick Guide

### **Basic Usage**

```js
const Queue = require('bull');

const videoQueue = new Queue('video transcoding', 'redis://127.0.0.1:6379');
const audioQueue = new Queue('audio transcoding', { redis: { port: 6379, host: '127.0.0.1', password: 'foobared' } }); // Specify Redis connection using object
const imageQueue = new Queue('image transcoding');
const pdfQueue = new Queue('pdf transcoding');

videoQueue.process(function (job, done) {

  // job.data contains the custom data passed when the job was created
  // job.id contains id of this job.

  // transcode video asynchronously and report progress
  job.progress(42);

  // call done when finished
  done();

  // or give a error if error
  done(new Error('error transcoding'));

  // or pass it a result
  done(null, { framerate: 29.5 /* etc... */ });

  // If the job throws an unhandled exception it is also handled correctly
  throw new Error('some unexpected error');
});

audioQueue.process(function (job, done) {
  // transcode audio asynchronously and report progress
  job.progress(42);

  // call done when finished
  done();

  // or give a error if error
  done(new Error('error transcoding'));

  // or pass it a result
  done(null, { samplerate: 48000 /* etc... */ });

  // If the job throws an unhandled exception it is also handled correctly
  throw new Error('some unexpected error');
});

imageQueue.process(function (job, done) {
  // transcode image asynchronously and report progress
  job.progress(42);

  // call done when finished
  done();

  // or give a error if error
  done(new Error('error transcoding'));

  // or pass it a result
  done(null, { width: 1280, height: 720 /* etc... */ });

  // If the job throws an unhandled exception it is also handled correctly
  throw new Error('some unexpected error');
});

pdfQueue.process(function (job) {
  // Processors can also return promises instead of using the done callback
  return pdfAsyncProcessor();
});

videoQueue.add({ video: 'http://example.com/video1.mov' });
audioQueue.add({ audio: 'http://example.com/audio1.mp3' });
imageQueue.add({ image: 'http://example.com/image1.tiff' });
```

### **Using promises**

Alternatively, you can use return promises instead of using the `done` callback:

```javascript
videoQueue.process(function (job) { // don't forget to remove the done callback!
  // Simply return a promise
  return fetchVideo(job.data.url).then(transcodeVideo);

  // Handles promise rejection
  return Promise.reject(new Error('error transcoding'));

  // Passes the value the promise is resolved with to the "completed" event
  return Promise.resolve({ framerate: 29.5 /* etc... */ });

  // If the job throws an unhandled exception it is also handled correctly
  throw new Error('some unexpected error');
  // same as
  return Promise.reject(new Error('some unexpected error'));
});
```

### **Separate processes**

The process function can also be run in a separate process. This has several advantages:

* The process is sandboxed so if it crashes it does not affect the worker.
* You can run blocking code without affecting the queue (jobs will not stall).
* Much better utilization of multi-core CPUs.
* Less connections to redis.

In order to use this feature just create a separate file with the processor:

```js
// processor.js
module.exports = function (job) {
  // Do some heavy work

  return Promise.resolve(result);
}
```

And define the processor like this:

```js
// Single process:
queue.process('/path/to/my/processor.js');

// You can use concurrency as well:
queue.process(5, '/path/to/my/processor.js');

// and named processors:
queue.process('my processor', 5, '/path/to/my/processor.js');
```

### **Repeated jobs**

A job can be added to a queue and processed repeatedly according to a cron specification:

```js
  paymentsQueue.process(function (job) {
    // Check payments
  });

  // Repeat payment job once every day at 3:15 (am)
  paymentsQueue.add(paymentsData, { repeat: { cron: '15 3 * * *' } });
```

As a tip, check your expressions here to verify they are correct: [cron expression generator](https://crontab.cronhub.io)

### **Pause / Resume**

A queue can be paused and resumed globally (pass `true` to pause processing for just this worker):

```js
queue.pause().then(function () {
  // queue is paused now
});

queue.resume().then(function () {
  // queue is resumed now
})
```

### **Events**

A queue emits some useful events, for example...

```js
.on('completed', function (job, result) {
  // Job completed with output result!
})
```

For more information on events, including the full list of events that are fired, check out the Events reference

### **Queues performance**

Queues are cheap, so if you need many of them just create new ones with different names:

```javascript
const userJohn = new Queue('john');
const userLisa = new Queue('lisa');
.
.
.
```

However every queue instance will require new redis connections, check how to [reuse connections](https://github.com/OptimalBits/bull/blob/master/PATTERNS.md#reusing-redis-connections) or you can also use [named processors](https://github.com/OptimalBits/bull/blob/master/REFERENCE.md#queueprocess) to achieve a similar result.

### **Cluster support**

NOTE: From version 3.2.0 and above it is recommended to use threaded processors instead.

Queues are robust and can be run in parallel in several threads or processes without any risk of hazards or queue corruption. Check this simple example using cluster to parallelize jobs across processes:

```js
const Queue = require('bull');
const cluster = require('cluster');

const numWorkers = 8;
const queue = new Queue('test concurrent queue');

if (cluster.isMaster) {
  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }

  cluster.on('online', function (worker) {
    // Let's create a few jobs for the queue workers
    for (let i = 0; i < 500; i++) {
      queue.add({ foo: 'bar' });
    };
  });

  cluster.on('exit', function (worker, code, signal) {
    console.log('worker ' + worker.process.pid + ' died');
  });
} else {
  queue.process(function (job, jobDone) {
    console.log('Job done by worker', cluster.worker.id, job.id);
    jobDone();
  });
}
```

***
