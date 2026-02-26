export enum TelemetryAttributes {
  QueueName = 'bullmq.queue.name',
  QueueOperation = 'bullmq.queue.operation',
  BulkCount = 'bullmq.job.bulk.count',
  BulkNames = 'bullmq.job.bulk.names',
  JobName = 'bullmq.job.name',
  JobId = 'bullmq.job.id',
  JobKey = 'bullmq.job.key',
  JobIds = 'bullmq.job.ids',
  JobAttemptsMade = 'bullmq.job.attempts.made',
  DeduplicationKey = 'bullmq.job.deduplication.key',
  JobOptions = 'bullmq.job.options',
  JobProgress = 'bullmq.job.progress',
  QueueDrainDelay = 'bullmq.queue.drain.delay',
  QueueGrace = 'bullmq.queue.grace',
  QueueCleanLimit = 'bullmq.queue.clean.limit',
  QueueRateLimit = 'bullmq.queue.rate.limit',
  JobType = 'bullmq.job.type',
  QueueOptions = 'bullmq.queue.options',
  QueueEventMaxLength = 'bullmq.queue.event.max.length',
  WorkerOptions = 'bullmq.worker.options',
  WorkerName = 'bullmq.worker.name',
  WorkerId = 'bullmq.worker.id',
  WorkerRateLimit = 'bullmq.worker.rate.limit',
  WorkerDoNotWaitActive = 'bullmq.worker.do.not.wait.active',
  WorkerForceClose = 'bullmq.worker.force.close',
  WorkerStalledJobs = 'bullmq.worker.stalled.jobs',
  WorkerFailedJobs = 'bullmq.worker.failed.jobs',
  WorkerJobsToExtendLocks = 'bullmq.worker.jobs.to.extend.locks',
  /**
   * @deprecated TODO: Use JobAttemptFinishedTimestamp instead. This will be removed in a future version.
   */
  JobFinishedTimestamp = 'bullmq.job.finished.timestamp',
  JobAttemptFinishedTimestamp = 'bullmq.job.attempt.finished.timestamp',
  JobProcessedTimestamp = 'bullmq.job.processed.timestamp',
  JobResult = 'bullmq.job.result',
  JobFailedReason = 'bullmq.job.failed.reason',
  FlowName = 'bullmq.flow.name',
  JobSchedulerId = 'bullmq.job.scheduler.id',
  JobStatus = 'bullmq.job.status',
}

/**
 * Standard metric names for BullMQ telemetry
 */
export enum MetricNames {
  JobsCompleted = 'bullmq.jobs.completed',
  JobsFailed = 'bullmq.jobs.failed',
  JobsDelayed = 'bullmq.jobs.delayed',
  JobsRetried = 'bullmq.jobs.retried',
  JobsWaiting = 'bullmq.jobs.waiting',
  JobsWaitingChildren = 'bullmq.jobs.waiting_children',
  JobDuration = 'bullmq.job.duration',
}

export enum SpanKind {
  INTERNAL = 0,
  SERVER = 1,
  CLIENT = 2,
  PRODUCER = 3,
  CONSUMER = 4,
}
