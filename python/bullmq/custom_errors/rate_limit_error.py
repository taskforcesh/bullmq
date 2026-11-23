RATE_LIMIT_ERROR = "bullmq:rateLimitExceeded"


class RateLimitError(Exception):
    """
    Raised from inside a processor to signal that the queue has reached a
    rate limit. The worker moves the job back to wait (without consuming an
    attempt) instead of failing it.
    """

    def __init__(self, message: str = RATE_LIMIT_ERROR):
        super().__init__(message)
