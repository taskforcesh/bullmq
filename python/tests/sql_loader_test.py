import os
import tempfile
import unittest
from unittest.mock import patch

from bullmq.postgres import sql_loader


class TestSqlLoader(unittest.TestCase):
    def test_resolve_sql_root_uses_repo_src_postgres_in_repo_layout(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = os.path.join(tmpdir, "repo")
            module_dir = os.path.join(repo_root, "python", "bullmq", "postgres")
            os.makedirs(os.path.join(module_dir, "commands"))
            os.makedirs(os.path.join(module_dir, "migrations"))
            os.makedirs(os.path.join(repo_root, "python", "bullmq"), exist_ok=True)
            os.makedirs(os.path.join(repo_root, "src", "postgres", "commands"))
            os.makedirs(os.path.join(repo_root, "src", "postgres", "migrations"))

            with patch.object(sql_loader, "_MODULE_DIR", module_dir):
                resolved = sql_loader._resolve_sql_root()

        self.assertEqual(resolved, os.path.join(repo_root, "src", "postgres"))

    def test_resolve_sql_root_ignores_unrelated_ancestor_src_postgres(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            site_packages = os.path.join(tmpdir, "site-packages")
            module_dir = os.path.join(site_packages, "bullmq", "postgres")
            os.makedirs(os.path.join(module_dir, "commands"))
            os.makedirs(os.path.join(module_dir, "migrations"))
            os.makedirs(os.path.join(site_packages, "src", "postgres", "commands"))
            os.makedirs(os.path.join(site_packages, "src", "postgres", "migrations"))

            with patch.object(sql_loader, "_MODULE_DIR", module_dir):
                resolved = sql_loader._resolve_sql_root()

        self.assertEqual(resolved, module_dir)
