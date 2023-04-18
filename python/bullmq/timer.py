import asyncio

# Credits: https://stackoverflow.com/questions/45419723/python-timer-with-asyncio-coroutine


class Timer:
    def __init__(self, interval: int, callback, *args, **kwargs):
        self.interval = interval
        self.args = args
        self.kwargs = kwargs
        self.callback = callback
        self._ok = True
        self._task = asyncio.ensure_future(self._job())

    async def _job(self):
        try:
            while self._ok:
                await asyncio.sleep(self.interval)
                await self.callback(*self.args, **self.kwargs)
        except Exception as ex:
            print(ex)

    def stop(self):
        self._ok = False
        self._task.cancel()
