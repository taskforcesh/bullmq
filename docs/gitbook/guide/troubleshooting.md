# Troubleshooting

In this section, you will be able to find hints and solutions for some common errors you might encounter when using BullMQ.

### Missing Locks

An error that can be thrown by the workers has the following structure: “Missing lock for job 1234. moveToFinished.” This error occurs when a job being processed by a worker unexpectedly loses its “lock.”

When a worker processes a job, it requires a special lock key to ensure that the job is currently “owned” by that worker, preventing other workers from picking up the same job. However, this lock can be deleted, and such a deletion may not be detected until the worker tries to move the job to a completed or failed status.

A lock can be deleted for several reasons, the most common being::

* The worker is consuming too much CPU and has no time to renew the lock every 30 seconds (which is the default expiration time for locks)
* The worker has lost communication with Redis and cannot renew the lock in time.
* The job has been forcefully removed using one of BullMQ's APIs to remove jobs (or by removing the entire queue).
* The Redis instance has a wrong [maxmemory](https://docs.bullmq.io/guide/going-to-production#max-memory-policy) policy; it should be no-eviction to avoid Redis removing keys with the expiration date before hand.

### Invalid or Undefined Environment Variables

If you rely on environment variables (e.g., for queue names or job data), a common pitfall is passing them directly to BullMQ methods when those environment variables are:

* Undefined (not set at all)
* Empty strings (i.e., "")
* Non-string values (e.g., inadvertently passing objects or arrays)

This can cause BullMQ’s internal Lua scripts to throw ERR Error running script ... Lua redis() command arguments must be strings or integers. It typically happens when a parameter passed into the Redis command ends up being something other than a valid string or number.

**Best Practices to Avoid This Error**

1.  Validate Environment Variables Early

    In your application’s initialization code, check all required environment variables:

```typescript
const queueName = process.env.QUEUE_NAME;
if (!queueName) {
  throw new Error("QUEUE_NAME is not defined or is empty.");
}

const queue = new Queue(queueName, { ... });
```

This ensures you fail fast if a variable isn’t set, instead of causing hidden Lua script errors.

2. Use TypeScript Strictness

If you’re using TypeScript, enable strictNullChecks and explicitly type environment variables as string | undefined. That way, any code that attempts to use them without proper checks will cause a compile-time error.

3. Provide Defaults Where Appropriate

In some cases, you may want a fallback value if an environment variable is missing:

```typescript
const queueName = process.env.QUEUE_NAME ?? 'defaultQueue';
```

But be sure this fallback is actually valid in your production workflow.

Following these guidelines helps prevent obscure Lua script errors in BullMQ that stem from passing undefined or invalid arguments into Redis commands.
