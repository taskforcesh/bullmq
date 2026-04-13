import asyncio
from typing import Any, Callable

# Credits: https://stackoverflow.com/questions/45419723/python-timer-with-asyncio-coroutine


class Timer:
    def __init__(self, interval: int, callback: Callable[..., Any], emit_callback: Callable[[str, Any], None], *args: Any, **kwargs: Any) -> None:
        self.interval = interval
        self.args = args
        self.kwargs = kwargs
        self.callback = callback
        self.emit = emit_callback
        self._ok = True
        self._task = asyncio.ensure_future(self._job())

    async def _job(self) -> None:
        try:
            while self._ok:
                await asyncio.sleep(self.interval)
                await self.callback(*self.args, **self.kwargs)
        except Exception as err:
            self.emit("error", err)
            pass

    def stop(self) -> None:
        self._ok = False
        self._task.cancel()
