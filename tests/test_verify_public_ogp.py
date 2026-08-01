import struct
import unittest
from unittest.mock import patch

from scripts import check_jairo, verify_public_ogp

BASE = verify_public_ogp.BASE_URL
IMAGE_URL = BASE + verify_public_ogp.IMAGE_NAME
DESCRIPTION = f"OK 3 / サーバーエラー 2 — 2026-08-01 20:37 時点。{verify_public_ogp.DISCLAIMER}"


def png_bytes(width=1200, height=630, truncated=False):
    header = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x0dIHDR" + struct.pack(">II", width, height)
    return header[:16] if truncated else header + b"\x08\x06\x00\x00\x00" + b"\x00" * 32


def page(**overrides):
    metas = {
        "og:url": BASE,
        "og:image": IMAGE_URL,
        "twitter:image": IMAGE_URL,
        "twitter:card": "summary_large_image",
        "og:description": DESCRIPTION,
        "twitter:description": DESCRIPTION,
    }
    metas.update(overrides)
    tags = "".join(
        f'<meta property="{key}" content="{value}">'
        for key, value in metas.items()
        if value is not None
    )
    return f"<html><head>{tags}</head><body></body></html>"


def responses(markup=None, image=None, image_headers=None, image_status=200):
    """Build a fetch() stub returning canned page/image responses."""
    markup = page() if markup is None else markup
    image = png_bytes() if image is None else image
    headers = {"content-type": "image/png"} if image_headers is None else image_headers

    def fetch(url):
        if url == IMAGE_URL:
            return image_status, headers, image
        return 200, {"content-type": "text/html"}, markup.encode("utf-8")

    return fetch


class PngDimensionTests(unittest.TestCase):
    def test_reads_ihdr(self):
        self.assertEqual(verify_public_ogp.png_dimensions(png_bytes()), (1200, 630))

    def test_rejects_non_png(self):
        with self.assertRaisesRegex(ValueError, "not a PNG"):
            verify_public_ogp.png_dimensions(b"GIF89a" + b"\x00" * 32)

    def test_rejects_truncated_png(self):
        with self.assertRaisesRegex(ValueError, "truncated"):
            verify_public_ogp.png_dimensions(png_bytes(truncated=True))


class PageCheckTests(unittest.TestCase):
    def test_accepts_a_complete_page(self):
        self.assertEqual(verify_public_ogp.check_page(BASE, page()), [])

    def test_reports_missing_tags(self):
        problems = verify_public_ogp.check_page(BASE, page(**{"twitter:card": None}))
        self.assertEqual(problems, ["twitter:card is missing"])

    def test_reports_relative_image_url(self):
        problems = verify_public_ogp.check_page(BASE, page(**{"og:image": "ogp.png"}))
        self.assertEqual(len(problems), 1)
        self.assertIn("og:image", problems[0])

    def test_reports_mismatched_descriptions(self):
        problems = verify_public_ogp.check_page(BASE, page(**{"twitter:description": "different"}))
        self.assertEqual(len(problems), 1)
        self.assertIn("differ", problems[0])

    def test_reports_missing_disclaimer(self):
        stripped = "OK 3 — 2026-08-01 20:37 時点。"
        problems = verify_public_ogp.check_page(
            BASE, page(**{"og:description": stripped, "twitter:description": stripped})
        )
        self.assertEqual(len(problems), 1)
        self.assertIn("disclaimer", problems[0])

    def test_shipped_index_html_satisfies_the_published_page_checks(self):
        # Guards against the dashboard and the verifier drifting apart: whatever
        # is committed must already pass what the release gate will assert.
        with check_jairo.INDEX_FILE.open("r", encoding="utf-8", newline="") as f:
            markup = f.read()
        self.assertEqual(verify_public_ogp.check_page(BASE, markup), [])


class ImageCheckTests(unittest.TestCase):
    def test_accepts_a_correct_image(self):
        self.assertEqual(
            verify_public_ogp.check_image(200, {"content-type": "image/png"}, png_bytes()), []
        )

    def test_accepts_content_type_with_parameters(self):
        headers = {"content-type": "image/png; charset=binary"}
        self.assertEqual(verify_public_ogp.check_image(200, headers, png_bytes()), [])

    def test_reports_wrong_dimensions(self):
        problems = verify_public_ogp.check_image(
            200, {"content-type": "image/png"}, png_bytes(600, 315)
        )
        self.assertEqual(len(problems), 1)
        self.assertIn("600x315", problems[0])

    def test_reports_truncated_png(self):
        problems = verify_public_ogp.check_image(
            200, {"content-type": "image/png"}, png_bytes(truncated=True)
        )
        self.assertEqual(len(problems), 1)
        self.assertIn("not a readable PNG", problems[0])

    def test_reports_wrong_status_and_content_type(self):
        problems = verify_public_ogp.check_image(404, {"content-type": "text/html"}, b"nope")
        self.assertEqual(len(problems), 3)


class MainTests(unittest.TestCase):
    def test_returns_zero_on_the_first_successful_attempt(self):
        with patch.object(verify_public_ogp, "fetch", side_effect=responses()), \
                patch.object(verify_public_ogp.time, "sleep") as sleep:
            self.assertEqual(verify_public_ogp.main([]), 0)
        sleep.assert_not_called()

    def test_retries_after_a_transient_failure(self):
        healthy = responses()
        calls = {"n": 0}

        def flaky(url):
            calls["n"] += 1
            if calls["n"] <= 2:  # first attempt fetches the page, then the image
                raise OSError("connection reset")
            return healthy(url)

        with patch.object(verify_public_ogp, "fetch", side_effect=flaky), \
                patch.object(verify_public_ogp.time, "sleep") as sleep:
            self.assertEqual(verify_public_ogp.main([]), 0)

        sleep.assert_called_once_with(verify_public_ogp.POLL_INTERVAL_SEC)

    def test_gives_up_and_reports_the_cause(self):
        fetch = responses(markup=page(**{"twitter:card": None}))
        with patch.object(verify_public_ogp, "fetch", side_effect=fetch), \
                patch.object(verify_public_ogp.time, "sleep"), \
                patch.object(verify_public_ogp, "MAX_ATTEMPTS", 3):
            with patch("sys.stderr") as stderr:
                self.assertEqual(verify_public_ogp.main([]), 1)

        written = "".join(call.args[0] for call in stderr.write.call_args_list)
        self.assertIn(BASE, written)
        self.assertIn("twitter:card is missing", written)
        self.assertIn("3 attempt(s)", written)

    def test_normalises_a_base_url_without_a_trailing_slash(self):
        seen = []

        def fetch(url):
            seen.append(url)
            return responses()(url)

        with patch.object(verify_public_ogp, "fetch", side_effect=fetch), \
                patch.object(verify_public_ogp.time, "sleep"):
            self.assertEqual(verify_public_ogp.main([BASE.rstrip("/")]), 0)
        self.assertEqual(seen, [BASE, IMAGE_URL])


class DisclaimerTests(unittest.TestCase):
    def test_matches_the_checker(self):
        # The string is duplicated so the verifier stays standalone; keep the two
        # in step here rather than letting the release gate silently pass a card
        # whose disclaimer has changed.
        self.assertEqual(verify_public_ogp.DISCLAIMER, check_jairo.DISCLAIMER)


if __name__ == "__main__":
    unittest.main()
