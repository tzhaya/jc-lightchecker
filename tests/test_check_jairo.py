import importlib
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from scripts import check_jairo


class ClassifyTests(unittest.TestCase):
    def test_classifies_expected_states(self):
        cases = [
            ((None, None, "timeout"), "TIMEOUT"),
            ((None, None, "connection_error"), "UNKNOWN"),
            ((500, 1, None), "SERVER_ERROR"),
            ((200, 15, None), "VERY_SLOW"),
            ((200, 5, None), "SLOW"),
            ((200, 1, None), "OK"),
            ((404, 1, None), "UNKNOWN"),
        ]
        for args, expected in cases:
            with self.subTest(args=args):
                self.assertEqual(check_jairo.classify(*args), expected)


class TargetTests(unittest.TestCase):
    def test_rejects_non_https_targets(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "targets.yml"
            path.write_text("targets:\n  - name: unsafe\n    url: javascript:alert(1)\n", encoding="utf-8")
            with patch.object(check_jairo, "TARGETS_FILE", path):
                with self.assertRaisesRegex(ValueError, "must use HTTPS"):
                    check_jairo.load_targets()

    def test_loads_https_target(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "targets.yml"
            path.write_text("targets:\n  - name: safe\n    url: https://example.com/\n    primary: true\n", encoding="utf-8")
            with patch.object(check_jairo, "TARGETS_FILE", path):
                self.assertEqual(check_jairo.load_targets(), [{
                    "name": "safe", "url": "https://example.com/", "primary": True,
                }])


class HistoryRetentionConfigTests(unittest.TestCase):
    def test_defaults_to_14_days_when_unset(self):
        self.assertEqual(check_jairo.HISTORY_RETENTION_DAYS, 14)

    def test_reads_override_from_environment(self):
        with patch.dict(os.environ, {"HISTORY_RETENTION_DAYS": "30"}):
            importlib.reload(check_jairo)
        try:
            self.assertEqual(check_jairo.HISTORY_RETENTION_DAYS, 30)
        finally:
            importlib.reload(check_jairo)


class HistoryPruneTests(unittest.TestCase):
    def _write_history(self, path, records):
        with path.open("w", encoding="utf-8") as f:
            for record in records:
                f.write(json.dumps(record) + "\n")

    def test_keeps_records_within_retention(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "history.jsonl"
            now = datetime.now(check_jairo.JST)
            recent = {"checked_at": now.isoformat(timespec="seconds")}
            self._write_history(path, [recent])
            with patch.object(check_jairo, "HISTORY_FILE", path):
                check_jairo.prune_history(14)
            kept = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(kept, [recent])

    def test_drops_records_older_than_retention(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "history.jsonl"
            now = datetime.now(check_jairo.JST)
            old = {"checked_at": (now - timedelta(days=20)).isoformat(timespec="seconds")}
            recent = {"checked_at": now.isoformat(timespec="seconds")}
            self._write_history(path, [old, recent])
            with patch.object(check_jairo, "HISTORY_FILE", path):
                check_jairo.prune_history(14)
            kept = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(kept, [recent])

    def test_drops_unparseable_lines_without_raising(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "history.jsonl"
            path.write_text('not json\n{"checked_at": "not a date"}\n', encoding="utf-8")
            with patch.object(check_jairo, "HISTORY_FILE", path):
                check_jairo.prune_history(14)
            self.assertEqual(path.read_text(encoding="utf-8"), "")

    def test_missing_file_does_not_raise(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "does-not-exist.jsonl"
            with patch.object(check_jairo, "HISTORY_FILE", path):
                check_jairo.prune_history(14)
            self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
