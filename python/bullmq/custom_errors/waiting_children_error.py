class WaitingChildrenError(Exception):
    "Raised when job is moved to waiting-children from inside the processor"
    pass
