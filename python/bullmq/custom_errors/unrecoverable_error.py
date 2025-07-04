class UnrecoverableError(Exception):
    "Raised when job is moved to failed without more retries"
    pass