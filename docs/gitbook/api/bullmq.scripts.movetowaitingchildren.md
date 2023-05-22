<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [bullmq](./bullmq.md) &gt; [Scripts](./bullmq.scripts.md) &gt; [moveToWaitingChildren](./bullmq.scripts.movetowaitingchildren.md)

## Scripts.moveToWaitingChildren() method

Move parent job to waiting-children state.

<b>Signature:</b>

```typescript
static moveToWaitingChildren(queue: MinimalQueue, jobId: string, token: string, opts?: MoveToChildrenOpts): Promise<boolean>;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  queue | [MinimalQueue](./bullmq.minimalqueue.md) |  |
|  jobId | string |  |
|  token | string |  |
|  opts | [MoveToChildrenOpts](./bullmq.movetochildrenopts.md) |  |

<b>Returns:</b>

Promise&lt;boolean&gt;

true if job is successfully moved, false if there are pending dependencies.

## Exceptions

JobNotExist This exception is thrown if jobId is missing.

JobLockNotExist This exception is thrown if job lock is missing.

JobNotInState This exception is thrown if job is not in active state.
