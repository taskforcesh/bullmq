"""
Tests for JobScheduler (repeatable job factories).
"""

import os
import time
import unittest
from uuid import uuid4
from zoneinfo import ZoneInfoNotFoundError

from croniter import CroniterBadCronError
import redis.asyncio as redis

from bullmq import Queue
from bullmq.job_scheduler import default_repeat_strategy, _transform_scheduler_data


prefix = os.environ.get("BULLMQ_TEST_PREFIX") or "bull"


class TestJobScheduler(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.queueName = f"__test_queue__{uuid4().hex}"

    async def asyncTearDown(self):
        connection = redis.Redis(host="localhost")
        await connection.flushdb()
        await connection.aclose()

    async def test_upsert_every_creates_scheduler_and_next_job(self):
        queue = Queue(self.queueName, {"prefix": prefix})
        try:
            job = await queue.upsertJobScheduler(
                "every-id",
                {"every": 60_000},
                job_name="repeat-every",
                job_data={"foo": "bar"},
            )
            self.assertIsNotNone(job)
            self.assertTrue(job.id.startswith("repeat:every-id:"))

            count = await queue.getJobSchedulersCount()
            self.assertEqual(count, 1)

            is_scheduler = await queue.isJobScheduler("every-id")
            self.assertTrue(is_scheduler)
        finally:
            await queue.close()

    async def test_upsert_pattern_creates_scheduler(self):
        queue = Queue(self.queueName, {"prefix": prefix})
        try:
            # `* * * * *` = every minute. We only verify the scheduler is
            # registered and the next iteration is materialized.
            job = await queue.upsertJobScheduler(
                "cron-id",
                {"pattern": "* * * * *"},
                job_name="repeat-cron",
                job_data={"hello": "world"},
            )
            self.assertIsNotNone(job)
            self.assertTrue(job.id.startswith("repeat:cron-id:"))

            scheduler = await queue.getJobScheduler("cron-id")
            self.assertIsNotNone(scheduler)
            self.assertEqual(scheduler["name"], "repeat-cron")
            self.assertEqual(scheduler.get("pattern"), "* * * * *")
            self.assertIsNotNone(scheduler.get("next"))
        finally:
            await queue.close()

    async def test_upsert_override_replaces_pending_iteration(self):
        queue = Queue(self.queueName, {"prefix": prefix})
        try:
            first = await queue.upsertJobScheduler(
                "ovr-id",
                {"every": 120_000},
                job_name="ovr",
                job_data={"v": 1},
            )
            second = await queue.upsertJobScheduler(
                "ovr-id",
                {"every": 30_000},
                job_name="ovr",
                job_data={"v": 2},
            )

            self.assertIsNotNone(first)
            self.assertIsNotNone(second)
            # Override regenerates the pending delayed job and may change
            # the iteration's next-millis when `every` is altered.
            self.assertEqual(await queue.getJobSchedulersCount(), 1)

            scheduler = await queue.getJobScheduler("ovr-id")
            self.assertEqual(scheduler.get("every"), 30_000)
        finally:
            await queue.close()

    async def test_upsert_returns_none_when_limit_reached(self):
        queue = Queue(self.queueName, {"prefix": prefix})
        try:
            # count + 1 > limit -> None
            result = await queue.upsertJobScheduler(
                "limit-id",
                {"every": 1000, "limit": 1, "count": 5},
                job_name="limited",
            )
            self.assertIsNone(result)
            self.assertEqual(await queue.getJobSchedulersCount(), 0)
        finally:
            await queue.close()

    async def test_upsert_returns_none_when_end_date_passed(self):
        queue = Queue(self.queueName, {"prefix": prefix})
        try:
            past = int(time.time() * 1000) - 10_000
            result = await queue.upsertJobScheduler(
                "expired-id",
                {"every": 1000, "endDate": past},
                job_name="expired",
            )
            self.assertIsNone(result)
            self.assertEqual(await queue.getJobSchedulersCount(), 0)
        finally:
            await queue.close()

    async def test_remove_job_scheduler(self):
        queue = Queue(self.queueName, {"prefix": prefix})
        try:
            await queue.upsertJobScheduler(
                "remove-id",
                {"every": 60_000},
                job_name="to-remove",
            )
            self.assertEqual(await queue.getJobSchedulersCount(), 1)

            ok = await queue.removeJobScheduler("remove-id")
            self.assertEqual(ok, 0)
            self.assertEqual(await queue.getJobSchedulersCount(), 0)
            self.assertFalse(await queue.isJobScheduler("remove-id"))

            # Removing a non-existent scheduler returns 1.
            missing = await queue.removeJobScheduler("does-not-exist")
            self.assertEqual(missing, 1)
        finally:
            await queue.close()

    async def test_get_job_schedulers_paginates(self):
        queue = Queue(self.queueName, {"prefix": prefix})
        try:
            for i in range(3):
                await queue.upsertJobScheduler(
                    f"sched-{i}",
                    {"every": (i + 1) * 60_000},
                    job_name=f"sched-{i}",
                )

            self.assertEqual(await queue.getJobSchedulersCount(), 3)

            schedulers = await queue.getJobSchedulers(0, -1, asc=True)
            self.assertEqual(len(schedulers), 3)
            keys = {s["key"] for s in schedulers}
            self.assertEqual(keys, {"sched-0", "sched-1", "sched-2"})
            for s in schedulers:
                self.assertIsNotNone(s.get("next"))
                self.assertIsNotNone(s.get("every"))
        finally:
            await queue.close()

    async def test_get_scheduler_decodes_template_opts(self):
        """Stored template opts use the short-key encoding (fpof, idof, ...).
        `getJobScheduler` must decode them back to their public names."""
        queue = Queue(self.queueName, {"prefix": prefix})
        try:
            await queue.upsertJobScheduler(
                "decode-id",
                {"every": 60_000},
                job_name="decode",
                job_data={"foo": "bar"},
                # `failParentOnFailure` encodes to short key `fpof`.
                opts={"failParentOnFailure": True, "attempts": 3},
            )
            scheduler = await queue.getJobScheduler("decode-id")
            template_opts = scheduler.get("template", {}).get("opts") or {}
            # The decoded opts must use the public name, not the short key.
            self.assertNotIn("fpof", template_opts)
            self.assertTrue(template_opts.get("failParentOnFailure"))
            self.assertEqual(template_opts.get("attempts"), 3)
        finally:
            await queue.close()

    async def test_validation_rejects_mutually_exclusive_options(self):
        queue = Queue(self.queueName, {"prefix": prefix})
        try:
            with self.assertRaises(ValueError):
                await queue.upsertJobScheduler(
                    "bad-id",
                    {"every": 1000, "pattern": "* * * * *"},
                    job_name="bad",
                )

            with self.assertRaises(ValueError):
                await queue.upsertJobScheduler(
                    "bad-id-2",
                    {},
                    job_name="bad",
                )

            with self.assertRaises(ValueError):
                await queue.upsertJobScheduler(
                    "bad-id-3",
                    {"pattern": "* * * * *", "immediately": True,
                     "startDate": int(time.time() * 1000)},
                    job_name="bad",
                )
        finally:
            await queue.close()


class TestDefaultRepeatStrategy(unittest.TestCase):
    """Unit tests for default_repeat_strategy: invalid inputs raise so
    misconfigured schedulers fail loudly at upsert time."""

    def test_invalid_cron_pattern_raises(self):
        with self.assertRaises(CroniterBadCronError):
            default_repeat_strategy(0, {"pattern": "not-a-cron"})

    def test_unknown_timezone_raises(self):
        with self.assertRaises(ZoneInfoNotFoundError):
            default_repeat_strategy(
                0, {"pattern": "* * * * *", "tz": "Not/AZone"}
            )

    def test_immediately_returns_now(self):
        millis = default_repeat_strategy(
            0, {"pattern": "* * * * *", "immediately": True}
        )
        self.assertIsNotNone(millis)
        # Within 5s of wall-clock now.
        self.assertLess(abs(millis - int(time.time() * 1000)), 5000)


class TestKeyToDataFallback(unittest.TestCase):
    """Unit tests for the legacy colon-delimited key fallback."""

    def test_legacy_repeatable_key_decoded(self):
        result = _transform_scheduler_data(
            "myname:my-id:1700000000000:UTC:0 0 * * *", {}, 12345
        )
        self.assertEqual(result["name"], "myname")
        self.assertEqual(result["id"], "my-id")
        self.assertEqual(result["endDate"], 1700000000000)
        self.assertEqual(result["tz"], "UTC")
        self.assertEqual(result["pattern"], "0 0 * * *")
        self.assertEqual(result["next"], 12345)

    def test_non_legacy_key_returns_none(self):
        self.assertIsNone(_transform_scheduler_data("plain-id", {}, None))


if __name__ == "__main__":
    unittest.main()
