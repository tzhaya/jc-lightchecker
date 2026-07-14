import tempfile
import unittest
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


if __name__ == "__main__":
    unittest.main()
