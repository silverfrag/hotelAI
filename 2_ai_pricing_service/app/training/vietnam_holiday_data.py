"""Inspect published Vietnamese holiday-window statistics without training.

Windows are inclusive civil dates in Asia/Ho_Chi_Minh. A holiday aggregate is
one target, never a source of manufactured daily or hourly training labels.
"""
from __future__ import annotations

import argparse
import json
import math
import re
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from urllib.parse import urlparse


METRICS = {
    "room_occupancy_rate": ("percent", {"tourist_accommodation_rooms"}),
    "lodging_guest_visits": ("guest_visits", {
        "domestic_lodging_guests", "international_lodging_guests", "all_lodging_guests",
    }),
    "tourist_visits": ("visitor_visits", {
        "domestic_visitors", "international_visitors", "all_visitors",
    }),
}
SERIES_FIELDS = (
    "region_id", "boundary_id", "metric", "unit", "population",
    "accommodation_segment", "status",
)


def _text(row: dict, field: str) -> str:
    value = row.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a nonempty string")
    return value


def _date(value: str, field: str) -> date:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError(f"{field} must be an ISO civil date")
    try:
        result = date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"Invalid {field}") from exc
    if not 1900 <= result.year <= 2100:
        raise ValueError(f"{field} is outside supported years")
    return result


def _url(value: str) -> None:
    if not isinstance(value, str):
        raise ValueError("source_url must be a public HTTPS URL")
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("source_url must be a public HTTPS URL without credentials")


def validate_observation(row: dict) -> None:
    """Validate structure/semantics; verifying a source remains a review step."""
    if not isinstance(row, dict):
        raise ValueError("Each observation must be an object")
    for field in ("observation_id", "region_id", "region_name", "boundary_id",
                  "boundary_description", "holiday_id", "source_title", "source_locator",
                  "status_basis"):
        _text(row, field)
    if not re.fullmatch(r"VN(?:-[A-Z0-9]+)*", row["region_id"]):
        raise ValueError("region_id must identify a Vietnamese geography")
    if not row["boundary_id"].startswith(row["region_id"] + "-"):
        raise ValueError("boundary_id must explicitly version the region")
    if row.get("geography_level") not in {"country", "province", "municipality", "district"}:
        raise ValueError("Unknown geography_level")
    if row.get("timezone") != "Asia/Ho_Chi_Minh":
        raise ValueError("Window dates must use Asia/Ho_Chi_Minh")

    start = _date(row.get("window_start"), "window_start")
    end = _date(row.get("window_end"), "window_end")
    holiday_start = _date(row.get("holiday_window_start"), "holiday_window_start")
    holiday_end = _date(row.get("holiday_window_end"), "holiday_window_end")
    if not holiday_start <= start <= end <= holiday_end:
        raise ValueError("Observation window must be within the reported holiday window")
    if (holiday_end - holiday_start).days >= 32:
        raise ValueError("A holiday window cannot be a monthly or annual aggregate")
    if "boundary_valid_from" not in row or "boundary_valid_through" not in row:
        raise ValueError("Declare boundary validity dates, using null when unknown")
    if row["boundary_valid_from"] is not None:
        if start < _date(row["boundary_valid_from"], "boundary_valid_from"):
            raise ValueError("Observation predates this geographic boundary")
    if row["boundary_valid_through"] is not None:
        if end > _date(row["boundary_valid_through"], "boundary_valid_through"):
            raise ValueError("Observation crosses this geographic boundary")

    metric = row.get("metric")
    if metric not in METRICS:
        raise ValueError("Unknown metric; do not convert visitor trips to lodging guests")
    unit, populations = METRICS[metric]
    if row.get("unit") != unit or row.get("population") not in populations:
        raise ValueError("Metric, unit and population must agree")
    if row.get("accommodation_segment") not in {
        "all_or_unspecified", "4_5_star", "1_3_star", "other", "not_applicable",
    }:
        raise ValueError("Unknown accommodation_segment")
    if (metric == "tourist_visits") != (row["accommodation_segment"] == "not_applicable"):
        raise ValueError("Visitor totals have no accommodation segment")
    if row.get("status") not in {"estimate", "reported", "final"}:
        raise ValueError("Status must retain the source's estimate/reported/final distinction")

    value = row.get("measurement")
    if not isinstance(value, dict):
        raise ValueError("measurement must preserve point, range or one-sided bound")
    fields = {
        "point": {"kind", "value", "qualifier"},
        "range": {"kind", "lower", "upper", "qualifier"},
        "lower_bound": {"kind", "lower", "inclusive", "qualifier"},
        "upper_bound": {"kind", "upper", "inclusive", "qualifier"},
    }.get(value.get("kind"))
    if fields is None or set(value) != fields:
        raise ValueError("measurement fields must match its kind; no inferred midpoint")
    if value["qualifier"] not in {"as_reported", "approximate"}:
        raise ValueError("Preserve whether the source describes an approximate value")
    for field in ("value", "lower", "upper"):
        if field not in value:
            continue
        number = value[field]
        if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) or number < 0:
            raise ValueError("Measurements must be finite nonnegative numbers")
        if unit == "percent" and number > 100:
            raise ValueError("Occupancy percentage must be between 0 and 100")
    if value["kind"] == "range" and value["lower"] >= value["upper"]:
        raise ValueError("Range lower bound must be smaller than upper bound")
    if "inclusive" in value and not isinstance(value["inclusive"], bool):
        raise ValueError("A one-sided bound must preserve inclusive/exclusive semantics")

    _url(row.get("source_url"))
    retrieved = _date(row.get("source_checked_on"), "source_checked_on")
    if retrieved < end:
        raise ValueError("Observed targets cannot be transcribed before their window ends")
    if "published_at" not in row:
        raise ValueError("published_at must be provided or explicitly null")
    published = row["published_at"]
    if row.get("publication_date_basis") not in {"page_published_date", "page_updated_date", "unknown"}:
        raise ValueError("Declare the source of the publication date")
    if (published is None) != (row["publication_date_basis"] == "unknown"):
        raise ValueError("Unknown publication date and its basis must agree")
    if published is not None:
        publication = _date(published, "published_at")
        if publication < start or publication > retrieved:
            raise ValueError("Publication must fall between window start and source review")
        if row["status"] != "estimate" and publication < end:
            raise ValueError("Completed reported/final targets cannot be published before window end")
    flags = row.get("review_flags", [])
    if not isinstance(flags, list) or any(not isinstance(flag, str) or not flag.strip() for flag in flags):
        raise ValueError("review_flags must contain nonempty review reasons")


def inspect_observations(rows: list[dict], minimum_windows: int = 12,
                         minimum_years: int = 3, as_of: str | None = None) -> dict:
    """Screen comparable series; duplicates/revisions never increase coverage.

    Date-only publications are available strictly AFTER that civil date, avoiding
    assuming a report was already available at the start of its publication day.
    """
    if not isinstance(rows, list) or not rows:
        raise ValueError("Provide a nonempty observations array")
    for name, value in (("minimum_windows", minimum_windows), ("minimum_years", minimum_years)):
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise ValueError(f"{name} must be a positive integer")
    cutoff = _date(as_of, "as_of") if as_of is not None else None
    groups = defaultdict(list)
    excluded = Counter()
    ids = set()
    for row in rows:
        validate_observation(row)
        if row["observation_id"] in ids:
            raise ValueError("observation_id must be unique; revisions need distinct identifiers")
        ids.add(row["observation_id"])
        if cutoff is not None:
            if row["published_at"] is None:
                excluded["unknown_publication_date"] += 1
                continue
            if _date(row["published_at"], "published_at") >= cutoff:
                excluded["not_available_before_as_of_day"] += 1
                continue
            if _date(row["window_end"], "window_end") >= cutoff:
                excluded["window_not_completed_before_as_of_day"] += 1
                continue
        groups[tuple(row[field] for field in SERIES_FIELDS)].append(row)

    series = []
    region_windows = set()
    for key, observations in sorted(groups.items()):
        by_window = defaultdict(list)
        for row in observations:
            window = (row["window_start"], row["window_end"])
            by_window[window].append(row)
            region_windows.add((row["region_id"], row["boundary_id"], *window))
        windows = sorted(by_window)
        conflicts, duplicates, overlapping = [], 0, []
        cluster_end, independent_groups = None, 0
        for index, window in enumerate(windows):
            records = by_window[window]
            values = {json.dumps(row["measurement"], sort_keys=True) for row in records}
            if len(values) > 1:
                conflicts.append(list(window))
            duplicates += len(records) - len(values)
            # Connected overlap clusters, not row count, bound effective coverage.
            if cluster_end is None or window[0] > cluster_end:
                independent_groups += 1
                cluster_end = window[1]
            else:
                cluster_end = max(cluster_end, window[1])
            for previous in windows[:index]:
                if previous[1] >= window[0]:
                    overlapping.append([list(previous), list(window)])
        years = sorted({int(start[:4]) for start, _ in windows})
        reasons = []
        if independent_groups < minimum_windows:
            reasons.append("too_few_non_overlapping_windows")
        if len(years) < minimum_years:
            reasons.append("too_few_years_for_temporal_evaluation")
        if conflicts:
            reasons.append("conflicting_target_revisions_require_review")
        if overlapping:
            reasons.append("overlapping_windows_require_joint_split_or_exclusion")
        if any(row["published_at"] is None for row in observations):
            reasons.append("unknown_publication_dates_block_as_of_evaluation")
        if any(row.get("review_flags") for row in observations):
            reasons.append("source_review_flags_unresolved")
        if any(row["measurement"]["kind"] != "point" for row in observations):
            reasons.append("non_point_targets_require_interval_aware_objective")
        if key[-1] == "estimate":
            reasons.append("estimated_targets_require_separate_experiment")
        series.append({
            **dict(zip(SERIES_FIELDS, key)),
            "input_rows": len(observations), "distinct_region_window_targets": len(windows),
            "non_overlapping_window_groups": independent_groups,
            "duplicate_measurement_rows": duplicates, "conflicting_windows": conflicts,
            "overlapping_windows": overlapping, "years": years,
            "holiday_ids": sorted({row["holiday_id"] for row in observations}),
            "measurement_kinds": dict(Counter(row["measurement"]["kind"] for row in observations)),
            "source_urls": sorted({row["source_url"] for row in observations}),
            "screening_status": "needs_more_data_or_review" if reasons else "eligible_for_benchmark_design",
            "reasons": reasons,
        })
    return {
        "schema_version": "1.0.0", "input_rows": len(rows), "as_of": as_of,
        "available_rows": sum(item["input_rows"] for item in series),
        "as_of_excluded_rows": dict(excluded),
        "distinct_region_windows_across_metrics": len(region_windows),
        "minimum_windows_screen": minimum_windows, "minimum_years_screen": minimum_years,
        "series": series, "model_trained": False,
        "limits": [
            "No daily/hourly labels, interval midpoints or prices are generated.",
            "Region-window counts are not counts of hotels, bookings or statistical independence.",
            "Country/province aggregates and populations can overlap; never sum them as independent samples.",
            "Reported means published without an explicit final-data designation, not certified final.",
            "Holiday-only observations do not identify causal holiday uplift versus ordinary days.",
            "Coverage screening is not predictive accuracy or permission to promote a model.",
            "The validator checks structure; source authenticity/transcription still require human review.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--minimum-windows", type=int, default=12)
    parser.add_argument("--minimum-years", type=int, default=3)
    parser.add_argument("--as-of", help="Use only completed targets published before this ISO civil date")
    args = parser.parse_args()
    try:
        payload = json.loads(args.input.read_text(encoding="utf-8-sig"))
        rows = payload if isinstance(payload, list) else payload["observations"]
        report = inspect_observations(rows, args.minimum_windows, args.minimum_years, args.as_of)
    except (ValueError, KeyError, TypeError) as exc:
        parser.error(str(exc))
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        if args.output.resolve() == args.input.resolve():
            parser.error("Output must not overwrite the source dataset")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")


if __name__ == "__main__":
    main()
