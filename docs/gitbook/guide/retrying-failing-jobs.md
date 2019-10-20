# Retrying failing jobs

When a processor throws an exception, the worker will catch it and move the job to the failed set. But sometimes it may be desirable to retry a failed job.

BullMQ support retries of failed jobs using backoff functions.

