export enum ErrorCodes {
  JobNotExist = -1,
  JobLockNotExist = -2,
  JobNotInState = -3,
  JobPendingDependencies = -4,
  ActiveJobsExist = -5,
  QueueNotPaused = -10,
}
