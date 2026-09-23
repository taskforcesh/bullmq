import unittest

from bullmq import Queue


class TestQueueJobTypes(unittest.TestCase):
    def test_sanitize_job_types_does_not_add_paused_for_waiting(self):
        self.assertCountEqual(
            Queue.sanitizeJobTypes(None, ["waiting"]),
            ["waiting"],
        )

    def test_sanitize_job_types_defaults_match_v6(self):
        self.assertCountEqual(
            Queue.sanitizeJobTypes(None, []),
            [
                "active",
                "completed",
                "delayed",
                "failed",
                "prioritized",
                "waiting",
                "waiting-children",
            ],
        )
