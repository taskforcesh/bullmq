from typing import TypedDict


class DeduplicationOptions(TypedDict, total=False):
    """
    Deduplication options.
    """

    id: str
    """
    Identifier for deduplication.
    
    Required field that uniquely identifies the deduplication key.
    """

    ttl: int
    """
    Time-to-live in milliseconds for the deduplication key.
    
    If not provided, the deduplication will last until the job is completed or failed.
    """

    extend: bool
    """
    If true, extend the TTL on each duplicate job attempt.
    
    When a duplicate job is detected, the TTL will be reset to the original value.
    """

    replace: bool
    """
    If true, replace the job data when a duplicate is added (while delayed).
    
    This is useful in debounce mode where you want to keep only the latest job data.
    """
