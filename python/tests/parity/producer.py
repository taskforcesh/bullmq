import asyncio
from datetime import datetime
from uuid import uuid4

from bullmq import Queue
from tests.parity.utils import getParityBackendOptions, logEvent, readDefinitions


async def createJobs():
    backendOptions = getParityBackendOptions()
    definitions = readDefinitions()

    logEvent("ready")
    for definition in definitions:
        queue = Queue(definition.get("id", ""), backendOptions)

        testSecret = str(uuid4())
        for i in range(int(definition.get("job", {}).get("count"))):
            jobName = f"job-{i}"
            jobSecret = str(uuid4())
            await queue.add(
                jobName,
                {"test_secret": testSecret, "job_secret": jobSecret},
                {"delay": definition.get("job", {}).get("delay")},
            )

            logEvent(
                "job-created",
                {
                    "timestamp": int(datetime.now().timestamp() * 1000),
                    "test_id": str(definition.get("id")),
                    "job_name": jobName,
                    "test_secret": testSecret,
                    "job_secret": jobSecret,
                },
            )

        await queue.close()


if __name__ == "__main__":
    asyncio.run(createJobs())
