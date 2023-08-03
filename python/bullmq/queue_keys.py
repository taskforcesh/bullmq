class QueueKeys:
    """
    This class handles all keys parser logic.
    """

    def __init__(self, prefix: str = 'bull'):
        self.prefix = prefix

    def getKeys(self, name: str):
        names = ["", "active", "wait", "waiting-children", "paused", "completed", "failed", "delayed",
                 "stalled", "limiter", "prioritized", "id", "stalled-check", "meta", "pc", "events"]
        keys = {}
        for name in names:
            keys[name] = self.toKey(name)

        return keys

    def toKey(self, name: str, type: str):
        return f"{self.getQueueQualifiedName(name)}:{type}"

    def getQueueQualifiedName(self, name: str):
        return f"{self.prefix}:{name}"
