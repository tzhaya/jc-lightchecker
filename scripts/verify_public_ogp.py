"""Verify the published social-card metadata and image.

Run this by hand once after a release, not from check.yml or ci.yml: what it
checks is a property of the Pages deployment, not of any single 15-minute run,
and GitHub Pages publishes asynchronously (up to ~10 minutes), so wiring it into
either workflow would make their outcome depend on Pages latency.

Unlike check_jairo.py -- which must never exit non-zero, so the dashboard always
has data -- this script is a release gate. It reports why it failed and exits 1.

    python scripts/verify_public_ogp.py [base_url]
"""

from __future__ import annotations

import struct
import sys
import time
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE_URL = "https://tzhaya.github.io/jc-lightchecker/"
IMAGE_NAME = "ogp.png"
EXPECTED_WIDTH = 1200
EXPECTED_HEIGHT = 630
EXPECTED_CARD = "summary_large_image"

# Must match check_jairo.DISCLAIMER; tests/test_verify_public_ogp.py locks the two
# together so the card can never lose the disclaimer without a test failing.
DISCLAIMER = "非公式・個人運用のダッシュボードです。"

# A single request needs its own bound: the deadline below only limits how many
# attempts we make, so without this one hung urlopen could outlast all of them.
REQUEST_TIMEOUT_SEC = 20
POLL_INTERVAL_SEC = 30
DEADLINE_SEC = 600
MAX_ATTEMPTS = 20

USER_AGENT = "jc-lightchecker-verify/0.1 (+https://github.com/tzhaya/jc-lightchecker)"


class MetaCollector(HTMLParser):
    """Collects <meta> content keyed by its property= or name= attribute."""

    def __init__(self) -> None:
        super().__init__()
        self.metas: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "meta":
            return
        attributes = dict(attrs)
        key = attributes.get("property") or attributes.get("name")
        if key is not None and "content" in attributes:
            self.metas[key] = attributes["content"] or ""


def fetch(url: str) -> tuple[int, dict[str, str], bytes]:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=REQUEST_TIMEOUT_SEC) as response:
        headers = {key.lower(): value for key, value in response.headers.items()}
        return response.status, headers, response.read()


def png_dimensions(data: bytes) -> tuple[int, int]:
    """Read width/height out of a PNG's IHDR chunk."""
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("response is not a PNG file")
    if len(data) < 24 or data[12:16] != b"IHDR":
        raise ValueError("PNG is truncated or missing its IHDR chunk")
    return struct.unpack(">II", data[16:24])


def check_page(base_url: str, markup: str) -> list[str]:
    collector = MetaCollector()
    collector.feed(markup)
    metas = collector.metas
    problems: list[str] = []

    expected_image = base_url + IMAGE_NAME
    for key, expected in (
        ("og:url", base_url),
        ("og:image", expected_image),
        ("twitter:image", expected_image),
        ("twitter:card", EXPECTED_CARD),
    ):
        actual = metas.get(key)
        if actual is None:
            problems.append(f"{key} is missing")
        elif actual != expected:
            problems.append(f"{key} is {actual!r}, expected {expected!r}")

    og_description = metas.get("og:description")
    twitter_description = metas.get("twitter:description")
    if og_description is None:
        problems.append("og:description is missing")
    if twitter_description is None:
        problems.append("twitter:description is missing")
    if og_description is not None and twitter_description is not None:
        if og_description != twitter_description:
            problems.append(
                f"og:description and twitter:description differ: "
                f"{og_description!r} vs {twitter_description!r}"
            )
        elif DISCLAIMER not in og_description:
            problems.append(f"description is missing the disclaimer: {og_description!r}")

    return problems


def check_image(status: int, headers: dict[str, str], body: bytes) -> list[str]:
    problems: list[str] = []
    if status != 200:
        problems.append(f"{IMAGE_NAME} returned HTTP {status}")
    content_type = headers.get("content-type", "").split(";")[0].strip()
    if content_type != "image/png":
        problems.append(f"{IMAGE_NAME} Content-Type is {content_type!r}, expected 'image/png'")

    try:
        width, height = png_dimensions(body)
    except ValueError as exc:
        problems.append(f"{IMAGE_NAME} is not a readable PNG: {exc}")
    else:
        if (width, height) != (EXPECTED_WIDTH, EXPECTED_HEIGHT):
            problems.append(
                f"{IMAGE_NAME} is {width}x{height}, expected "
                f"{EXPECTED_WIDTH}x{EXPECTED_HEIGHT}"
            )
    return problems


def verify_once(base_url: str) -> list[str]:
    problems: list[str] = []

    try:
        status, _, body = fetch(base_url)
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        problems.append(f"could not fetch {base_url}: {exc}")
    else:
        if status != 200:
            problems.append(f"{base_url} returned HTTP {status}")
        else:
            problems.extend(check_page(base_url, body.decode("utf-8", errors="replace")))

    image_url = base_url + IMAGE_NAME
    try:
        status, headers, body = fetch(image_url)
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        problems.append(f"could not fetch {image_url}: {exc}")
    else:
        problems.extend(check_image(status, headers, body))

    return problems


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    base_url = args[0] if args else BASE_URL
    if not base_url.endswith("/"):
        base_url += "/"

    started = time.monotonic()
    problems: list[str] = []

    for attempt in range(1, MAX_ATTEMPTS + 1):
        problems = verify_once(base_url)
        if not problems:
            print(f"OK: {base_url} verified on attempt {attempt}.")
            return 0

        elapsed = time.monotonic() - started
        if attempt == MAX_ATTEMPTS or elapsed + POLL_INTERVAL_SEC > DEADLINE_SEC:
            break

        print(
            f"attempt {attempt} found {len(problems)} problem(s); "
            f"retrying in {POLL_INTERVAL_SEC}s (Pages publishes asynchronously)",
            file=sys.stderr,
        )
        time.sleep(POLL_INTERVAL_SEC)

    print(f"FAILED: {base_url}", file=sys.stderr)
    print(
        f"  gave up after {attempt} attempt(s), "
        f"{time.monotonic() - started:.0f}s elapsed",
        file=sys.stderr,
    )
    for problem in problems:
        print(f"  - {problem}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
