# Persistent connections

A crucial feature for a subsystem in a microservice architecture is that it should automatically handle disconnections from other services and keep these connections alive for as long as the service is running.

For example, if your service has a connection to a database, and the connection to said database breaks, you would like that service to handle this disconnection as gracefully as possible and as soon as the database is back online continue to work without human intervention.

BullMQ uses **ioredis** by default, where the default is auto-reconnect forever. This behaviour can be customized but most likely the default is the best setting currently: [https://github.com/luin/ioredis#auto-reconnect](https://github.com/luin/ioredis#auto-reconnect). If you use another Redis client through an adapter, configure the equivalent reconnect behaviour in that client.

In the context of BullMQ, we have normally two different cases that are handled differently.

### Workers

A worker is consuming jobs from the queue as fast as it can. If it loses the connection to Redis we want the worker to "wait" until Redis is available again. For this to work with the default ioredis client we need to understand an important setting in our Redis options:

#### `maxRetriesPerRequest`

This setting tells the ioredis client how many times to try a command that fails before throwing an error. So even though Redis is not reachable or offline, the command will be retried until this situation changes or the maximum number of attempts is reached.

In BullMQ we set this setting to null both for the "bclient" and "eclient" connections, which are used for the workers and events respectively.

This guarantees that the workers will keep processing forever as long as there is a working connection. If you create an ioredis client manually, BullMQ will throw an exception if this setting is not set to null.

### Queue

A simple Queue instance used for managing the queue such as adding jobs, pausing, using getters, etc. usually has different requirements from the worker.

For example, say that you are adding jobs to a queue as the result of a call to an HTTP endpoint. The caller of this endpoint cannot wait forever if the connection to Redis happens to be down when this call is made.

Therefore the `maxRetriesPerRequest` setting should either be left at its default (which currently is 20) or set it to another value, maybe 1 so that the user gets an error quickly and can retry later.

### Using node-redis or Bun adapters

If you use BullMQ through `createNodeRedisClient` or `createBunRedisClient`, apply the same principle even though the option names are different from ioredis:

- `Worker`/consumer paths should keep retrying and recover automatically.
- `Queue`/producer paths should fail quickly so callers can retry later.

For `node-redis`, tune reconnect and timeout behavior on the raw `redis` client you create in your application (for example reconnect strategy and socket/command timeout related options) to match the producer vs consumer behavior above.

For Bun's Redis client, BullMQ's Bun adapter includes automatic reconnect with exponential backoff for unexpected disconnects. You should still validate startup-failure, transient-disconnect, and graceful-shutdown scenarios in your deployment environment.
