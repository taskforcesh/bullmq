import asyncio

# Credits: https://stackoverflow.com/questions/45419723/python-timer-with-asyncio-coroutine


class Timer:
    def __init__(self, interval: int, callback, emit_callback, *args, **kwargs):
        self.interval = interval
        self.args = args
        self.kwargs = kwargs
        self.callback = callback
        self.emit = emit_callback
        self._ok = True
        self._task = asyncio.ensure_future(self._job())

    async def _job(self):
        try:
            while self._ok:
                await asyncio.sleep(self.interval)
                await self.callback(*self.args, **self.kwargs)
        except Exception as err:
            self.emit("error", err)
            pass

    def stop(self):
        self._ok = False
        self._task.cancel()
