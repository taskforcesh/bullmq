export enum TelemetryAttributes {
  QueueName = 'bullmq.queue.name',
  QueueOperation = 'bullmq.queue.operation',

  /**
   * @deprecated Use BulkCount_ instead. This will be removed in a future version.
   */
  BulkCount = 'bullmq.job.bulk.count',
  BulkCount_ = 'bullmq.job.bulk_count',

  /**
   * @deprecated Use BulkNames_ instead. This will be removed in a future version.
   */
  BulkNames = 'bullmq.job.bulk.names',
  BulkNames_ = 'bullmq.job.bulk_names',

  JobName = 'bullmq.job.name',
  JobId = 'bullmq.job.id',
  JobKey = 'bullmq.job.key',
  JobIds = 'bullmq.job.ids',

  /**
   * @deprecated Use JobAttemptsMade_ instead. This will be removed in a future version.
   */
  JobAttemptsMade = 'bullmq.job.attempts.made',
  JobAttemptsMade_ = 'bullmq.job.attempts_made',

  /**
   * @deprecated Use DeduplicationKey_ instead. This will be removed in a future version.
   */
  DeduplicationKey = 'bullmq.job.deduplication.key',
  DeduplicationKey_ = 'bullmq.job.deduplication_key',

  JobOptions = 'bullmq.job.options',
  JobProgress = 'bullmq.job.progress',

  /**
   * @deprecated Use QueueDrainDelay_ instead. This will be removed in a future version.
   */
  QueueDrainDelay = 'bullmq.queue.drain.delay',
  QueueDrainDelay_ = 'bullmq.queue.drain_delay',

  QueueGrace = 'bullmq.queue.grace',

  /**
   * @deprecated Use QueueCleanLimit_ instead. This will be removed in a future version.
   */
  QueueCleanLimit = 'bullmq.queue.clean.limit',
  QueueCleanLimit_ = 'bullmq.queue.clean_limit',

  /**
   * @deprecated Use QueueRateLimit_ instead. This will be removed in a future version.
   */
  QueueRateLimit = 'bullmq.queue.rate.limit',
  QueueRateLimit_ = 'bullmq.queue.rate_limit',

  JobType = 'bullmq.job.type',
  QueueOptions = 'bullmq.queue.options',

  /**
   * @deprecated Use QueueEventMaxLength_ instead. This will be removed in a future version.
   */
  QueueEventMaxLength = 'bullmq.queue.event.max.length',
  QueueEventMaxLength_ = 'bullmq.queue.event_max_length',

  WorkerOptions = 'bullmq.worker.options',
  WorkerName = 'bullmq.worker.name',
  WorkerId = 'bullmq.worker.id',

  /**
   * @deprecated Use WorkerRateLimit_ instead. This will be removed in a future version.
   */
  WorkerRateLimit = 'bullmq.worker.rate.limit',
  WorkerRateLimit_ = 'bullmq.worker.rate_limit',

  /**
   * @deprecated Use WorkerDoNotWaitActive_ instead. This will be removed in a future version.
   */
  WorkerDoNotWaitActive = 'bullmq.worker.do.not.wait.active',
  WorkerDoNotWaitActive_ = 'bullmq.worker.do_not_wait_active',

  /**
   * @deprecated Use WorkerForceClose_ instead. This will be removed in a future version.
   */
  WorkerForceClose = 'bullmq.worker.force.close',
  WorkerForceClose_ = 'bullmq.worker.force_close',

  /**
   * @deprecated Use WorkerStalledJobs_ instead. This will be removed in a future version.
   */
  WorkerStalledJobs = 'bullmq.worker.stalled.jobs',
  WorkerStalledJobs_ = 'bullmq.worker.stalled_jobs',

  /**
   * @deprecated Use WorkerFailedJobs_ instead. This will be removed in a future version.
   */
  WorkerFailedJobs = 'bullmq.worker.failed.jobs',
  WorkerFailedJobs_ = 'bullmq.worker.failed_jobs',

  /**
   * @deprecated Use WorkerJobsToExtendLocks_ instead. This will be removed in a future version.
   */
  WorkerJobsToExtendLocks = 'bullmq.worker.jobs.to.extend.locks',
  WorkerJobsToExtendLocks_ = 'bullmq.worker.jobs_to_extend_locks',

  /**
   * @deprecated Use JobAttemptFinishedTimestamp_ instead. This will be removed in a future version.
   */
  JobFinishedTimestamp = 'bullmq.job.finished.timestamp',

  JobAttemptFinishedTimestamp = 'bullmq.job.attempt_finished_timestamp',

  /**
   * @deprecated Use JobProcessedTimestamp_ instead. This will be removed in a future version.
   */
  JobProcessedTimestamp = 'bullmq.job.processed.timestamp',
  JobProcessedTimestamp_ = 'bullmq.job.processed_timestamp',

  JobResult = 'bullmq.job.result',

  /**
   * @deprecated Use JobFailedReason_ instead. This will be removed in a future version.
   */
  JobFailedReason = 'bullmq.job.failed.reason',
  JobFailedReason_ = 'bullmq.job.failed_reason',

  FlowName = 'bullmq.flow.name',

  /**
   * @deprecated Use JobSchedulerId_ instead. This will be removed in a future version.
   */
  JobSchedulerId = 'bullmq.job.scheduler.id',
  JobSchedulerId_ = 'bullmq.job.scheduler_id',

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
