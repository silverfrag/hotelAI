from copy import deepcopy

import pytest

from app.training.vietnam_market_data import inspect_observations


def observation(period="2024-08", value=78.93, **changes):
    return {
        "region_id": "VN-KH-pre-2025-07", "period": period,
        "statistic": "room_occupancy_rate", "segment": "all", "value": value,
        "unit": "percent", "status": "official", "source_report_period": "2024-09",
        "source_url": "https://example.gov.vn/report.pdf", "source_page": 1,
        "published_at": "2024-09-23", **changes,
    }


def test_report_month_does_not_replace_observation_month():
    report = inspect_observations([
        observation(), observation("2024-09", 57.62, status="estimate"),
    ])
    series = report["series"][0]
    assert series["first_period"] == series["last_period"] == "2024-08"
    assert series["official_distinct_months"] == 1
    assert series["estimate_rows_excluded"] == 1
    assert report["model_trained"] is False


def test_segments_and_boundary_versions_never_pool_into_more_months():
    rows = [observation(), observation(segment="4_5_star"),
            observation(region_id="VN-KH-post-2025-07")]
    report = inspect_observations(rows)
    assert len(report["series"]) == 3
    assert all(s["official_distinct_months"] == 1 for s in report["series"])


def test_duplicate_sources_do_not_inflate_coverage_or_hide_revisions():
    row = observation()
    series = inspect_observations([row, deepcopy(row), observation(value=79.1)])["series"][0]
    assert series["official_distinct_months"] == 1
    assert series["conflicting_periods"] == ["2024-08"]
    assert "conflicting_official_revisions" in series["reasons"]


def test_gaps_and_unknown_publication_dates_require_review():
    series = inspect_observations([
        observation("2024-06"), observation(published_at=None),
    ], minimum_months=2)["series"][0]
    assert series["missing_periods"] == ["2024-07"]
    assert series["official_rows_without_publication_date"] == 1
    assert series["screening_status"] == "needs_more_data_or_review"


@pytest.mark.parametrize("changes", [
    {"value": float("nan")}, {"value": 100.01}, {"value": True},
    {"period": "2024-13"}, {"period": "2024-10"},
    {"status": "synthetic"}, {"statistic": "room_price"},
    {"source_page": 0}, {"source_url": "file:///private.pdf"},
    {"published_at": "2024-02-31"},
])
def test_invalid_or_incompatible_observations_are_rejected(changes):
    with pytest.raises(ValueError):
        inspect_observations([observation(**changes)])


def test_coverage_pass_is_not_accuracy_or_training_approval():
    report = inspect_observations([observation("2024-07"), observation()], minimum_months=2)
    assert report["series"][0]["screening_status"] == "eligible_for_benchmark_design"
    assert report["model_trained"] is False
    assert any("predictive accuracy" in limit for limit in report["limits"])


def test_reviewed_transcription_does_not_clear_a_source_quality_flag():
    flagged = observation(review_flags=["aggregate_outside_reported_segment_range"])
    series = inspect_observations([flagged], minimum_months=1)["series"][0]
    assert series["official_distinct_months"] == 1
    assert series["official_rows_needing_source_review"] == 1
    assert series["screening_status"] == "needs_more_data_or_review"
    assert "source_values_need_review" in series["reasons"]


@pytest.mark.parametrize("flags", ["unreviewed", [None], [""]])
def test_malformed_source_review_flags_are_rejected(flags):
    with pytest.raises(ValueError, match="review_flags"):
        inspect_observations([observation(review_flags=flags)])
