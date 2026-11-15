"""Inspect source-backed monthly market observations without training a model.

Official provincial aggregates are not resort bookings or daily price labels.
Keep geography, reporting period, publication and estimate status explicit.
"""
from __future__ import annotations

import argparse
import json
import math
import re
from collections import defaultdict
from datetime import date
from pathlib import Path
from urllib.parse import urlparse


def month_index(value: str) -> int:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", value):
        raise ValueError(f"Invalid monthly period: {value!r}")
    year, month = map(int, value.split("-"))
    if not 1900 <= year <= 2100:
        raise ValueError("Observation year is outside the supported range")
    return year * 12 + month - 1


def validate_observation(row: dict) -> None:
    if not isinstance(row, dict):
        raise ValueError("Each observation must be an object")
    if not isinstance(row.get("region_id"), str) or not row["region_id"].startswith("VN-"):
        raise ValueError("Use an explicit Vietnamese region/boundary identifier")
    month_index(row.get("period"))
    report_month = month_index(row.get("source_report_period"))
    if report_month < month_index(row["period"]):
        raise ValueError("A report cannot contain an observation from a later monthly period")
    if row.get("statistic") != "room_occupancy_rate" or row.get("unit") != "percent":
        raise ValueError("This intake accepts room occupancy percentage only")
    if row.get("segment") not in {"all", "4_5_star", "1_3_star", "other"}:
        raise ValueError("Unknown accommodation segment")
    value = row.get("value")
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 100:
        raise ValueError("Occupancy must be a finite percentage from 0 to 100")
    if row.get("status") not in {"official", "estimate"}:
        raise ValueError("The PDF column must identify official or estimated values")
    url = urlparse(row.get("source_url", ""))
    if url.scheme != "https" or not url.hostname or url.username or url.password:
        raise ValueError("Each observation needs a public HTTPS source URL")
    page = row.get("source_page")
    if isinstance(page, bool) or not isinstance(page, int) or page < 1:
        raise ValueError("source_page must be a one-based PDF page")
    published = row.get("published_at")
    if published is not None:
        if not isinstance(published, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", published):
            raise ValueError("published_at must be a verified ISO date or null")
        date.fromisoformat(published)
    review_flags = row.get("review_flags", [])
    if not isinstance(review_flags, list) or any(
        not isinstance(flag, str) or not flag.strip() for flag in review_flags
    ):
        raise ValueError("review_flags must be a list of nonempty review reasons")


def inspect_observations(rows: list[dict], minimum_months: int = 36) -> dict:
    """Report coverage per geography/segment, excluding estimates from labels.

    36 months is an initial research screening threshold, not proof of model
    quality. Conflicting official revisions require review, never silent averaging.
    """
    if not isinstance(rows, list) or not rows:
        raise ValueError("Provide a nonempty observations array")
    if isinstance(minimum_months, bool) or not isinstance(minimum_months, int) or minimum_months < 1:
        raise ValueError("minimum_months must be a positive integer")
    groups = defaultdict(list)
    for row in rows:
        validate_observation(row)
        groups[(row["region_id"], row["statistic"], row["segment"])].append(row)
    series = []
    for (region, statistic, segment), observations in sorted(groups.items()):
        official = [r for r in observations if r["status"] == "official"]
        by_period = defaultdict(set)
        for row in official:
            by_period[row["period"]].add(row["value"])
        conflicts = sorted(period for period, values in by_period.items() if len(values) > 1)
        periods = sorted(by_period)
        indexes = {month_index(period) for period in periods}
        missing = [] if not indexes else [
            f"{index // 12:04d}-{index % 12 + 1:02d}"
            for index in range(min(indexes), max(indexes) + 1) if index not in indexes
        ]
        reasons = []
        if len(periods) < minimum_months:
            reasons.append("too_few_official_months")
        if missing:
            reasons.append("gaps_in_official_series")
        if conflicts:
            reasons.append("conflicting_official_revisions")
        unknown_dates = sum(r.get("published_at") is None for r in official)
        if unknown_dates:
            reasons.append("publication_dates_need_review_before_as_of_evaluation")
        flagged_rows = [r for r in official if r.get("review_flags")]
        if flagged_rows:
            reasons.append("source_values_need_review")
        series.append({
            "region_id": region, "statistic": statistic, "segment": segment,
            "official_distinct_months": len(periods), "official_rows": len(official),
            "estimate_rows_excluded": len(observations) - len(official),
            "first_period": periods[0] if periods else None,
            "last_period": periods[-1] if periods else None,
            "missing_periods": missing, "conflicting_periods": conflicts,
            "official_rows_without_publication_date": unknown_dates,
            "official_rows_needing_source_review": len(flagged_rows),
            "source_review_flags": sorted({flag for r in flagged_rows for flag in r["review_flags"]}),
            "screening_status": "needs_more_data_or_review" if reasons else "eligible_for_benchmark_design",
            "reasons": reasons,
        })
    return {
        "schema_version": "1.0.0", "input_rows": len(rows),
        "minimum_official_months_screen": minimum_months,
        "series": series, "model_trained": False,
        "limits": [
            "Monthly provincial occupancy is not daily resort occupancy or a price target.",
            "Calendar dates alone do not establish a learned festival effect.",
            "Passing coverage screening does not establish predictive accuracy.",
            "Source URLs and transcribed values still require source review.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--minimum-months", type=int, default=36)
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8-sig"))
    rows = payload if isinstance(payload, list) else payload["observations"]
    report = inspect_observations(rows, args.minimum_months)
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
