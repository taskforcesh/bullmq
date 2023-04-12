# Credits: https://gist.github.com/marc-x-andre/1c55b3fafd1d00cfdaa205ec53a08cf3
from typing import Dict


class EventEmitter:

    def __init__(self):
        self._callbacks: Dict[str, callable] = {}

    def on(self, event_name: str, function):
        self._callbacks[event_name] = self._callbacks.get(
            event_name, []) + [function]
        return function

    def emit(self, event_name: str, *args, **kwargs):
        [function(*args, **kwargs)
         for function in self._callbacks.get(event_name, [])]

    def off(self, event_name: str, function):
        self._callbacks.get(event_name, []).remove(function)
