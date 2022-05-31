# Custom backoff strategy

When the builtin backoff strategies on retries are not sufficient, a custom strategy can be defined. Custom backoff strategies are defined by a function on the queue. The number of attempts already made to process the job is passed to this function as the first parameter, and the error that the job failed with as the second parameter. The function returns either the time to delay the retry with, 0 to retry immediately or -1 to fail the job immediately.

```typescript
const Queue = require('bull');

const myQueue = new Queue('Server B', {
  settings: {
    backoffStrategies: {
      jitter: function (attemptsMade, err) {
        return 5000 + Math.random() * 500;
      }
    }
  }
});
```

The new backoff strategy can then be specified on the job, using the name defined above:

```typescript
myQueue.add({foo: 'bar'}, {
  attempts: 3,
  backoff: {
    type: 'jitter'
  }
});
```

You may specify options for your strategy:

```typescript
const Queue = require("bull");

const myQueue = new Queue("Server B", {
  settings: {
    backoffStrategies: {
      // truncated binary exponential backoff
      binaryExponential: function (attemptsMade, err, options) {
        // Options can be undefined, you need to handle it by yourself
        if (!options) {
          options = {};
        }
        const delay = options.delay || 1000;
        const truncate = options.truncate || 1000;
        console.error({ attemptsMade, err, options });
        return Math.round(
          Math.random() *
            (Math.pow(2, Math.max(attemptsMade, truncate)) - 1) *
            delay
        );
      },
    },
  },
});

myQueue.add(
  { foo: "bar" },
  {
    attempts: 10,
    backoff: {
      type: "binaryExponential",
      options: {
        delay: 500,
        truncate: 5,
      },
    },
  }
);

```

You may base your backoff strategy on the error that the job throws:

```typescript
const Queue = require('bull');

function MySpecificError() {};

const myQueue = new Queue('Server C', {
  settings: {
    backoffStrategies: {
      foo: function (attemptsMade, err) {
        if (err instanceof MySpecificError) {
          return 10000;
        }
        return 1000;
      }
    }
  }
});

myQueue.process(function (job, done) {
  if (job.data.msg === 'Specific Error') {
    throw new MySpecificError();
  } else {
    throw new Error();
  }
});

myQueue.add({ msg: 'Hello' }, {
  attempts: 3,
  backoff: {
    type: 'foo'
  }
});

myQueue.add({ msg: 'Specific Error' }, {
  attempts: 3,
  backoff: {
    type: 'foo'
  }
});
```

\
