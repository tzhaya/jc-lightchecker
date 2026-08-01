import importlib
import json
import os
import re
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


LATEST_FIXTURE = {
    "checked_at": "2026-08-01T20:37:48+09:00",
    "summary": {
        "level": "SERVER_ERROR",
        "message": "複数サイトでサーバーエラーまたはタイムアウトを確認しました。",
        "counts": {
            "OK": 3,
            "SLOW": 0,
            "VERY_SLOW": 0,
            "SERVER_ERROR": 2,
            "TIMEOUT": 2,
            "UNKNOWN": 0,
        },
        "total": 7,
    },
    "results": [],
}


class WriteTextAtomicTests(unittest.TestCase):
    def test_leaves_original_intact_when_replace_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "target.txt"
            path.write_text("original\n", encoding="utf-8")

            with patch.object(check_jairo.os, "replace", side_effect=OSError("boom")):
                with self.assertRaises(OSError):
                    check_jairo.write_text_atomic(path, "replacement\n")

            # The point of the helper: a failure must not truncate the target,
            # which is exactly what open(path, "w") would have done.
            self.assertEqual(path.read_text(encoding="utf-8"), "original\n")
            self.assertFalse(path.with_name(path.name + ".tmp").exists())

    def test_writes_content_verbatim(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "target.txt"
            check_jairo.write_text_atomic(path, "a\nb\n")
            self.assertEqual(path.read_bytes(), b"a\nb\n")


class DescriptionTests(unittest.TestCase):
    def test_summarises_counts_timestamp_and_disclaimer(self):
        description = check_jairo.format_status_description(LATEST_FIXTURE)
        self.assertIn("OK 3", description)
        self.assertIn("サーバーエラー 2", description)
        self.assertIn("タイムアウト 2", description)
        self.assertNotIn("遅延 0", description)
        self.assertIn("2026-08-01 20:37", description)
        self.assertTrue(description.endswith(check_jairo.DISCLAIMER))

    def test_falls_back_to_summary_message_without_counts(self):
        latest = {"checked_at": "2026-08-01T20:37:48+09:00", "summary": {"message": "監視対象が登録されていません。", "counts": {}}}
        description = check_jairo.format_status_description(latest)
        self.assertIn("監視対象が登録されていません。", description)
        self.assertTrue(description.endswith(check_jairo.DISCLAIMER))


class IndexMetadataTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        # Copy the real dashboard so the rewrite is exercised against the meta
        # tags as actually shipped; a format drift there should fail here.
        with check_jairo.INDEX_FILE.open("r", encoding="utf-8", newline="") as f:
            self.original = f.read()
        self.path = Path(directory.name) / "index.html"
        with self.path.open("w", encoding="utf-8", newline="") as f:
            f.write(self.original)

    def _read(self):
        with self.path.open("r", encoding="utf-8", newline="") as f:
            return f.read()

    @staticmethod
    def _meta(markup, marker):
        match = re.search(r'<meta ' + re.escape(marker) + r' content="([^"]*)">', markup)
        return match.group(1) if match else None

    def test_rewrites_both_descriptions_and_leaves_titles_alone(self):
        with patch.object(check_jairo, "INDEX_FILE", self.path):
            check_jairo.update_index_metadata(LATEST_FIXTURE)
        updated = self._read()

        og = self._meta(updated, 'property="og:description"')
        twitter = self._meta(updated, 'name="twitter:description"')
        self.assertEqual(og, twitter)
        self.assertIn("OK 3", og)
        self.assertIn(check_jairo.DISCLAIMER, og)

        for marker in ('property="og:title"', 'name="twitter:title"'):
            self.assertEqual(self._meta(updated, marker), self._meta(self.original, marker))

    def test_changes_only_the_two_description_lines(self):
        with patch.object(check_jairo, "INDEX_FILE", self.path):
            check_jairo.update_index_metadata(LATEST_FIXTURE)

        before = self.original.splitlines()
        after = self._read().splitlines()
        self.assertEqual(len(before), len(after))
        differing = [line for old, line in zip(before, after) if old != line]
        self.assertEqual(len(differing), 2, differing)
        self.assertTrue(all("description" in line for line in differing), differing)

    def test_refuses_to_write_when_a_tag_is_missing(self):
        with self.path.open("w", encoding="utf-8", newline="") as f:
            f.write('<meta property="og:description" content="only one">\n')
        before = self.path.read_bytes()

        with patch.object(check_jairo, "INDEX_FILE", self.path):
            with self.assertRaises(ValueError):
                check_jairo.update_index_metadata(LATEST_FIXTURE)

        self.assertEqual(self.path.read_bytes(), before)

    def test_main_exits_zero_and_leaves_html_intact_when_the_rewrite_fails(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        latest_file = Path(directory.name) / "latest.json"
        history_file = Path(directory.name) / "history.jsonl"
        before = self.path.read_bytes()

        real_write = check_jairo.write_text_atomic

        def fail_for_index(path, text):
            if path == self.path:
                raise OSError("disk full")
            return real_write(path, text)

        with patch.object(check_jairo, "INDEX_FILE", self.path), \
                patch.object(check_jairo, "LATEST_FILE", latest_file), \
                patch.object(check_jairo, "HISTORY_FILE", history_file), \
                patch.object(check_jairo, "OUTPUT_DIR", Path(directory.name)), \
                patch.object(check_jairo, "load_targets", return_value=[]), \
                patch.object(check_jairo, "write_text_atomic", side_effect=fail_for_index):
            self.assertEqual(check_jairo.main(), 0)

        self.assertEqual(self.path.read_bytes(), before)
        # The check's own outputs still landed: the rewrite is best-effort only.
        self.assertTrue(latest_file.exists())
        self.assertTrue(history_file.exists())


if __name__ == "__main__":
    unittest.main()
