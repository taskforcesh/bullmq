# Reusing Redis Connections

A standard queue requires **3 connections** to the Redis server. In some situations you might want to re-use connections—for example on Heroku where the connection count is restricted. You can do this with the `createClient` option in the `Queue` constructor.

#### Notes:

* bclient connections [cannot be re-used](https://github.com/OptimalBits/bull/issues/880), so you should return a new connection each time this is called.
* client and subscriber connections can be shared and will not be closed when the queue is closed. When you are shutting down the process, first close the queues, then the shared connections (if they are shared).
* if you are not sharing connections but still using `createClient` to do some custom connection logic, you may still need to keep a list of all the connections you created so you can manually close them later when the queue shuts down, if you need a graceful shutdown for your process
* do not set a `keyPrefix` on the connection you create, use bull's built-in prefix feature if you need a key prefix

```typescript
const { REDIS_URL } = process.env;

const Redis = require("ioredis");
const client = new Redis(REDIS_URL);
const subscriber = new Redis(REDIS_URL);

const opts = {
  // redisOpts here will contain at least a property of
  // connectionName which will identify the queue based on its name
  createClient: function (type, redisOpts) {
    switch (type) {
      case "client":
        return client;
      case "subscriber":
        return subscriber;
      case "bclient":
        return new Redis(REDIS_URL, redisOpts);
      default:
        throw new Error("Unexpected connection type: ", type);
    }
  },
};

const queueFoo = new Queue("foobar", opts);
const queueQux = new Queue("quxbaz", opts);

```
