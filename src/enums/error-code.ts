export enum ErrorCode {
  JobNotExist = -1,
  JobLockNotExist = -2,
  JobNotInState = -3,
  JobPendingChildren = -4,
  ParentJobNotExist = -5,
  JobLockMismatch = -6,
  ParentJobCannotBeReplaced = -7,
  JobBelongsToJobScheduler = -8,
  JobHasFailedChildren = -9,
  JobSchedulerCannotBeAdded = -10,
}
