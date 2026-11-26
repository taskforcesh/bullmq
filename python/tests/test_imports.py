"""
Tests that ensure the public API re-exports are stable.
"""

import unittest

import bullmq
import bullmq.custom_errors


class TestImports(unittest.TestCase):
    def test_unrecoverable_error_importable_from_package_root(self):
        """Ensure UnrecoverableError can be imported directly from bullmq."""
        from bullmq import UnrecoverableError
        self.assertIs(UnrecoverableError, bullmq.custom_errors.UnrecoverableError)

    def test_waiting_children_error_importable_from_package_root(self):
        """Ensure WaitingChildrenError can be imported directly from bullmq."""
        from bullmq import WaitingChildrenError
        self.assertIs(WaitingChildrenError, bullmq.custom_errors.WaitingChildrenError)

    def test_delayed_error_importable_from_package_root(self):
        """Ensure DelayedError can be imported directly from bullmq."""
        from bullmq import DelayedError
        self.assertIs(DelayedError, bullmq.custom_errors.DelayedError)

    def test_rate_limit_error_importable_from_package_root(self):
        """Ensure RateLimitError can be imported directly from bullmq."""
        from bullmq import RateLimitError
        self.assertIs(RateLimitError, bullmq.custom_errors.RateLimitError)


if __name__ == '__main__':
    unittest.main()
