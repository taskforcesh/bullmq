import asyncio
import signal
from datetime import datetime
from typing import Any

from bullmq.job import Job
from bullmq.worker import Worker
from tests.parity.utils import getParityBackendOptions, logEvent, readDefinitions


def createWorker(definition: dict[str, Any], backendOptions):
    async def processor(job: Job, _job_token):
        logEvent(
            "job-started",
            {
                "timestamp": int(datetime.now().timestamp() * 1000),
                "test_id": str(definition.get("id")),
                "job_name": job.name,
                "test_secret": job.data.get("test_secret"),
                "job_secret": job.data.get("job_secret"),
            },
        )

        sleepTime = definition.get("simulation", {}).get("sleep", 0)
        if sleepTime > 0:
            await asyncio.sleep(sleepTime / 1000)
        attemptsToFail = definition.get("simulation", {}).get("fail", 0)
        if job.attemptsMade < attemptsToFail:
            raise Exception("Throw error to simulate processing failure")

        logEvent(
            "job-completed",
            {
                "timestamp": int(datetime.now().timestamp() * 1000),
                "test_id": str(definition.get("id")),
                "job_name": job.name,
                "test_secret": job.data.get("test_secret"),
                "job_secret": job.data.get("job_secret"),
            },
        )

    worker = Worker(
        definition.get("id", ""),
        processor,
        dict(
            concurrency=definition.get("worker", {}).get("concurrency", 1),
            **backendOptions,
        ),
    )
    return worker


async def runConsumers():
    backendOptions = getParityBackendOptions()
    definitions = readDefinitions()
    workers: list[Worker] = []

    shutdown_event = asyncio.Event()

    def signal_handler(signal, frame):
        print(f"{signal} signal received, shutting down.")
        shutdown_event.set()

    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    for definition in definitions:
        worker = createWorker(definition, backendOptions)
        workers.append(worker)

    # Ready event sent once all the workers are ready to accept jobs
    logEvent("ready")
    _ = await shutdown_event.wait()

    for worker in workers:
        await worker.close()


if __name__ == "__main__":
    asyncio.run(runConsumers())
