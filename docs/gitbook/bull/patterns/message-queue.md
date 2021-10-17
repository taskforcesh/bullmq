# Message queue

Bull can also be used for persistent message queues. This is a quite useful feature in some use cases. For example, you can have two servers that need to communicate with each other. By using a queue the servers do not need to be online at the same time, so this creates a very robust communication channel. You can treat `add` as _send_ and `process` as _receive_:

Server A:

```typescript
const Queue = require('bull');

const sendQueue = new Queue('Server B');
const receiveQueue = new Queue('Server A');

receiveQueue.process(function (job, done) {
  console.log('Received message', job.data.msg);
  done();
});

sendQueue.add({ msg: 'Hello' });
```

Server B:

```typescript
const Queue = require('bull');

const sendQueue = new Queue('Server A');
const receiveQueue = new Queue('Server B');

receiveQueue.process(function (job, done) {
  console.log('Received message', job.data.msg);
  done();
});

sendQueue.add({ msg: 'World' });
```
