from __future__ import annotations

import json
import socket
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

JST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parents[1]
TARGETS_FILE = ROOT / "targets.yml"
OUTPUT_DIR = ROOT / "docs"
LATEST_FILE = OUTPUT_DIR / "latest.json"
HISTORY_FILE = OUTPUT_DIR / "history.jsonl"

TIMEOUT_SEC = 20
SLOW_SEC = 5
VERY_SLOW_SEC = 15

USER_AGENT = "jc-lightchecker/0.1 (+https://github.com/tzhaya/jc-lightchecker)"
STATES = ("OK", "SLOW", "VERY_SLOW", "SERVER_ERROR", "TIMEOUT", "UNKNOWN")


def classify(status_code: int | None, elapsed_sec: float | None, error_type: str | None) -> str:
    if error_type == "timeout":
        return "TIMEOUT"

    if error_type:
        return "UNKNOWN"

    if status_code in {500, 502, 503, 504}:
        return "SERVER_ERROR"

    if status_code is not None and 200 <= status_code < 400:
        if elapsed_sec is not None and elapsed_sec >= VERY_SLOW_SEC:
            return "VERY_SLOW"
        if elapsed_sec is not None and elapsed_sec >= SLOW_SEC:
            return "SLOW"
        return "OK"

    return "UNKNOWN"


def load_targets() -> list[dict[str, Any]]:
    targets: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    for raw_line in TARGETS_FILE.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line or line == "targets:":
            continue

        if line.startswith("- "):
            if current:
                targets.append(current)
            current = {}
            line = line[2:].strip()

        if ":" not in line:
            continue

        if current is None:
            raise ValueError("Target entries must be listed under 'targets:'.")

        key, value = line.split(":", 1)
        value = value.strip().strip("\"'")
        if value.lower() in {"true", "false"}:
            current[key.strip()] = value.lower() == "true"
        else:
            current[key.strip()] = value

    if current:
        targets.append(current)

    normalized = []
    for index, target in enumerate(targets, start=1):
        if not target.get("name") or not target.get("url"):
            raise ValueError(f"Target #{index} must include name and url.")
        parsed_url = urlparse(str(target["url"]))
        if parsed_url.scheme != "https" or not parsed_url.netloc:
            raise ValueError(f"Target #{index} URL must use HTTPS.")
        normalized.append(
            {
                "name": str(target["name"]),
                "url": str(target["url"]),
                "primary": bool(target.get("primary", False)),
            }
        )
    return normalized


def check_target(target: dict[str, Any]) -> dict[str, Any]:
    status_code = None
    elapsed_sec = None
    error_type = None
    error = None
    start = time.perf_counter()

    try:
        request = Request(
            target["url"],
            headers={"User-Agent": USER_AGENT},
        )
        with urlopen(request, timeout=TIMEOUT_SEC) as response:
            status_code = response.status
            response.read(1024)
        elapsed_sec = round(time.perf_counter() - start, 3)
    except TimeoutError:
        elapsed_sec = round(time.perf_counter() - start, 3)
        error_type = "timeout"
        error = f"Request timed out after {TIMEOUT_SEC} seconds."
    except HTTPError as exc:
        elapsed_sec = round(time.perf_counter() - start, 3)
        status_code = exc.code
        error = f"HTTP {exc.code}: {exc.reason}"
    except URLError as exc:
        elapsed_sec = round(time.perf_counter() - start, 3)
        reason = exc.reason
        if isinstance(reason, (TimeoutError, socket.timeout)):
            error_type = "timeout"
            error = f"Request timed out after {TIMEOUT_SEC} seconds."
        else:
            error_type = "connection_error"
            error = str(reason)
    except Exception as exc:  # Defensive: keep output valid even for unexpected failures.
        elapsed_sec = round(time.perf_counter() - start, 3)
        error_type = "unexpected_error"
        error = str(exc)

    state = classify(status_code, elapsed_sec, error_type)
    return {
        "name": target["name"],
        "url": target["url"],
        "primary": target["primary"],
        "status_code": status_code,
        "elapsed_sec": elapsed_sec,
        "state": state,
        "error_type": error_type,
        "error": error,
    }


def summarize(results: list[dict[str, Any]]) -> dict[str, Any]:
    counts = {state: 0 for state in STATES}
    for result in results:
        counts[result["state"]] = counts.get(result["state"], 0) + 1

    total = len(results)
    problematic = {"SLOW", "VERY_SLOW", "SERVER_ERROR", "TIMEOUT", "UNKNOWN"}
    severe = {"SERVER_ERROR", "TIMEOUT"}
    abnormal_count = sum(counts[state] for state in problematic)
    severe_count = sum(counts[state] for state in severe)

    primary_results = [result for result in results if result.get("primary")]
    primary_state = primary_results[0]["state"] if primary_results else None
    non_primary_results = [result for result in results if not result.get("primary")]
    non_primary_abnormal = sum(1 for result in non_primary_results if result["state"] in problematic)

    if total == 0:
        message = "監視対象が登録されていません。"
        level = "UNKNOWN"
    elif severe_count >= 2:
        message = "複数サイトでサーバーエラーまたはタイムアウトを確認しました。広域的事象の可能性があります。"
        level = "SERVER_ERROR"
    elif total > 1 and abnormal_count / total >= 0.5:
        message = "複数サイトで応答遅延または異常を確認しました。広域的遅延の可能性があります。"
        level = "VERY_SLOW"
    elif primary_state in problematic and non_primary_abnormal == 0:
        message = "primary サイトに異常または遅延があります。他サイトが正常なら自機関固有の可能性があります。"
        level = primary_state
    elif abnormal_count > 0:
        message = "一部サイトで応答遅延または異常を確認しました。"
        level = "SLOW"
    else:
        message = "大きな異常は確認されていません。"
        level = "OK"

    return {
        "level": level,
        "message": message,
        "counts": counts,
        "total": total,
        "primary_state": primary_state,
    }


def build_latest(targets: list[dict[str, Any]]) -> dict[str, Any]:
    checked_at = datetime.now(JST).isoformat(timespec="seconds")
    results = [check_target(target) for target in targets]
    return {
        "checked_at": checked_at,
        "thresholds": {
            "slow_sec": SLOW_SEC,
            "very_slow_sec": VERY_SLOW_SEC,
            "timeout_sec": TIMEOUT_SEC,
        },
        "summary": summarize(results),
        "results": results,
    }


def write_outputs(latest: dict[str, Any]) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with LATEST_FILE.open("w", encoding="utf-8") as f:
        json.dump(latest, f, ensure_ascii=False, indent=2)
        f.write("\n")

    with HISTORY_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(latest, ensure_ascii=False, separators=(",", ":")) + "\n")


def main() -> int:
    try:
        latest = build_latest(load_targets())
    except Exception as exc:
        checked_at = datetime.now(JST).isoformat(timespec="seconds")
        latest = {
            "checked_at": checked_at,
            "thresholds": {
                "slow_sec": SLOW_SEC,
                "very_slow_sec": VERY_SLOW_SEC,
                "timeout_sec": TIMEOUT_SEC,
            },
            "summary": {
                "level": "UNKNOWN",
                "message": "チェック処理の初期化に失敗しました。",
                "counts": {state: 0 for state in STATES},
                "total": 0,
                "primary_state": None,
            },
            "results": [],
            "error": str(exc),
        }

    write_outputs(latest)
    print(json.dumps(latest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
