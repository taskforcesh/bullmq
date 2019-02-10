# Bull

```js
//
// A worker could just consume 1 redis connection (blocking) 
// if it ignore delayed jobs. We can have a special class:
// DelayJobManager (just moves delay jobs to the queue when necessary)
//
const worker = new Worker('name', {
    redis: {},
    concurrency: number,
    limiter: RateLimiterOpts,
    skipDelayCheck: boolean,
    visibilityWindow: seconds,
}, 'myprocessor.js');

// What about external processors
class MyWorker extend Worker {
    async execute(jobName, jobData){
    }
}

worker.on('completed', (job: Job) => {
    console.log(job)
});
```

```js
const queue = new Queue("name", {
  redis: RedisOpts
});

// FIFO
queue.append("jobName", data, opts: JobOpts);

// LIFO
queue.prepend("jobName", data, opts: JobOpts);

queue.on("completed", jobId => {});

queue.on("failed", (jobId, err) => {});

queue.on("delayed", (jobId, delay), => {});

// Listen to all the events, from a given time (historical events)
queue.events( fromTime: number,  (eventName, time, args) => {

});

// The getters also will return the TIME of the event stream.
const snapshot = await queue.getCountsJobs();

```

```js
const cronQueue = new CronQueue('name', {
})

cronWorker.add('jobName', );
```

```js
const priorityQueue = new PriorityQueue('name', {});

```

# Idea for delayed jobs

A delayed job is placed in the queue, with the given timestamp. Queue works as normally.
When the delayed job reaches the tip of the queue, the diff between the created timestamp and the current timestap is calculated and if it is larger or equal than the delay it is executed, otherwise placed on the delayed set.
