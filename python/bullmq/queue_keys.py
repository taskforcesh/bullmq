class QueueKeys:
    """
    This class handles all keys parser logic.
    """

    def __init__(self, prefix: str = 'bull'):
        self.prefix = prefix

    def getKeys(self, name: str):
        names = ["", "active", "wait", "waiting-children", "paused", "completed", "failed", "delayed",
                 "stalled", "limiter", "prioritized", "id", "stalled-check", "meta", "pc", "events", "marker"]
        keys = {}
        for name_type in names:
            keys[name_type] = self.toKey(name, name_type)

        return keys

    def toKey(self, name: str, name_type: str):
        return f"{self.getQueueQualifiedName(name)}:{name_type}"

    def getQueueQualifiedName(self, name: str):
        return f"{self.prefix}:{name}"
