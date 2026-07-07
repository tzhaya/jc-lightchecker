from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from statistics import quantiles
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_HISTORY_FILE = ROOT / "docs" / "history.jsonl"
STATES = ("OK", "SLOW", "VERY_SLOW", "SERVER_ERROR", "TIMEOUT", "UNKNOWN")


def load_records(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []

    records = []
    with path.open(encoding="utf-8") as f:
        for line_number, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_number}: invalid JSONL record: {exc}") from exc
    return records


def percentile(values: list[float], percent: int) -> float | None:
    if not values:
        return None
    if len(values) == 1:
        return values[0]
    ordered = sorted(values)
    index = (len(ordered) - 1) * (percent / 100)
    lower = int(index)
    upper = min(lower + 1, len(ordered) - 1)
    weight = index - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def analyze(records: list[dict[str, Any]]) -> dict[str, Any]:
    elapsed_values = []
    state_counts = Counter()
    sample_count = 0

    for record in records:
        for result in record.get("results", []):
            if not isinstance(result, dict):
                continue
            sample_count += 1
            state_counts[result.get("state", "UNKNOWN")] += 1
            elapsed = result.get("elapsed_sec")
            if isinstance(elapsed, (int, float)):
                elapsed_values.append(float(elapsed))

    return {
        "records": len(records),
        "samples": sample_count,
        "elapsed": {
            "p50": percentile(elapsed_values, 50),
            "p90": percentile(elapsed_values, 90),
            "p95": percentile(elapsed_values, 95),
            "p99": percentile(elapsed_values, 99),
            "max": max(elapsed_values) if elapsed_values else None,
        },
        "states": {state: state_counts.get(state, 0) for state in STATES},
    }


def format_seconds(value: float | None) -> str:
    return "-" if value is None else f"{value:.3f}"


def print_report(summary: dict[str, Any]) -> None:
    elapsed = summary["elapsed"]
    states = summary["states"]

    print("# JAIRO Cloud History Analysis")
    print()
    print(f"- Records: {summary['records']}")
    print(f"- Samples: {summary['samples']}")
    print()
    print("| Metric | Seconds |")
    print("| --- | ---: |")
    print(f"| p50 | {format_seconds(elapsed['p50'])} |")
    print(f"| p90 | {format_seconds(elapsed['p90'])} |")
    print(f"| p95 | {format_seconds(elapsed['p95'])} |")
    print(f"| p99 | {format_seconds(elapsed['p99'])} |")
    print(f"| max | {format_seconds(elapsed['max'])} |")
    print()
    print("| State | Count |")
    print("| --- | ---: |")
    for state in STATES:
        print(f"| {state} | {states[state]} |")


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze docs/history.jsonl response trends.")
    parser.add_argument(
        "history_file",
        nargs="?",
        type=Path,
        default=DEFAULT_HISTORY_FILE,
        help="Path to history JSONL file.",
    )
    args = parser.parse_args()

    records = load_records(args.history_file)
    print_report(analyze(records))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
