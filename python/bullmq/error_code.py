from enum import Enum


class ErrorCode(Enum):
    JobNotExist = -1
    JobLockNotExist = -2
    JobNotInState = -3
    JobPendingDependencies = -4
    ParentJobNotExist = -5
    JobLockMismatch = -6
    ParentJobCannotBeReplaced = -7
