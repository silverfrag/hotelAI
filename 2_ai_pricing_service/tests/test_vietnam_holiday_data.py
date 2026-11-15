"""Regression checks for source scope, leakage and inflated target coverage."""
import copy
import json
import subprocess
import sys
from pathlib import Path

import pytest

from app.training.vietnam_holiday_data import inspect_observations, validate_observation


ROOT = Path(__file__).resolve().parents[1]
SAMPLE = ROOT / "data" / "vietnam_observed" / "holiday_windows.json"


def sample():
    return json.loads(SAMPLE.read_text(encoding="utf-8"))["observations"]


@pytest.fixture
def observation():
    return copy.deepcopy(next(row for row in sample() if row["observation_id"] == "national-2024-vn-occupancy"))


def revision(row, identifier, **changes):
    result = copy.deepcopy(row)
    result.update(observation_id=identifier, **changes)
    return result


def test_reviewed_sample_preserves_scope_and_is_not_training_ready():
    rows = sample()
    report = inspect_observations(rows)
    assert report["input_rows"] == 13
    assert report["distinct_region_windows_across_metrics"] == 11
    assert len(report["series"]) == 8
    assert report["model_trained"] is False
    assert all(s["screening_status"] == "needs_more_data_or_review" for s in report["series"])
    kh = next(s for s in report["series"] if s["region_id"] == "VN-KH" and s["metric"] == "tourist_visits")
    assert kh["distinct_region_window_targets"] == 3
    assert kh["years"] == [2024, 2025]
    assert kh["population"] == "all_visitors"
    # A source's range and exclusive lower bound are never replaced by a midpoint.
    assert rows[0]["measurement"] == {"kind": "range", "lower": 45, "upper": 50, "qualifier": "approximate"}
    peak = next(row for row in rows if "peak" in row["observation_id"])
    assert peak["measurement"] == {"kind": "lower_bound", "lower": 60, "inclusive": False, "qualifier": "as_reported"}


def test_new_reports_add_only_national_whole_window_occupancy():
    new = [row for row in sample() if row["source_url"].rsplit("/", 1)[-1] in {"274", "371"}]
    assert len(new) == 2
    assert all(row["region_id"] == "VN" and row["boundary_id"] == "VN-national" for row in new)
    assert all(row["metric"] == "room_occupancy_rate" for row in new)
    assert all((row["window_start"], row["window_end"]) ==
               (row["holiday_window_start"], row["holiday_window_end"]) for row in new)
    reunification, tet = new
    assert (reunification["window_start"], reunification["window_end"]) == ("2025-04-30", "2025-05-04")
    assert reunification["measurement"] == {"kind": "point", "value": 70, "qualifier": "approximate"}
    assert reunification["status"] == "reported"
    assert (tet["window_start"], tet["window_end"]) == ("2026-02-14", "2026-02-22")
    assert tet["measurement"] == {"kind": "range", "lower": 55, "upper": 60, "qualifier": "approximate"}
    assert tet["status"] == "estimate"
    # These later reports were unavailable at the end of their holiday windows.
    assert inspect_observations([reunification], as_of="2025-05-05")["available_rows"] == 0
    assert inspect_observations([reunification], as_of="2025-05-13")["available_rows"] == 1
    assert inspect_observations([tet], as_of="2026-02-23")["available_rows"] == 0
    assert inspect_observations([tet], as_of="2026-02-25")["available_rows"] == 1


def test_nested_peak_window_cannot_be_an_independent_holiday_target():
    rows = [r for r in sample() if r["observation_id"].startswith("national-2024-vn-")]
    series = inspect_observations(rows, minimum_windows=1, minimum_years=1)["series"][0]
    assert series["distinct_region_window_targets"] == 2
    assert series["non_overlapping_window_groups"] == 1
    assert len(series["overlapping_windows"]) == 1
    assert "overlapping_windows_require_joint_split_or_exclusion" in series["reasons"]
    assert "non_point_targets_require_interval_aware_objective" in series["reasons"]


def test_overlap_chain_is_one_group_not_three_independent_samples(observation):
    rows = [revision(observation, f"window-{i}", holiday_window_start="2024-09-01",
                     holiday_window_end="2024-09-10", window_start=start, window_end=end,
                     published_at="2024-09-11")
            for i, (start, end) in enumerate([
                ("2024-09-01", "2024-09-04"), ("2024-09-03", "2024-09-06"),
                ("2024-09-05", "2024-09-08"),
            ])]
    series = inspect_observations(rows)["series"][0]
    assert series["non_overlapping_window_groups"] == 1
    assert len(series["overlapping_windows"]) == 2


def test_republication_and_renamed_holiday_do_not_inflate_coverage(observation):
    duplicate = revision(observation, "republication", holiday_id="another_label",
                         source_url="https://example.gov.vn/republication", published_at="2024-09-04")
    series = inspect_observations([observation, duplicate])["series"][0]
    assert series["distinct_region_window_targets"] == 1
    assert series["non_overlapping_window_groups"] == 1
    assert series["duplicate_measurement_rows"] == 1


def test_conflicting_revision_requires_review_not_averaging(observation):
    changed = revision(observation, "revised")
    changed["measurement"]["value"] = 57
    result = inspect_observations([observation, changed], 1, 1)["series"][0]
    assert result["distinct_region_window_targets"] == 1
    assert result["conflicting_windows"] == [["2024-08-31", "2024-09-03"]]
    assert "conflicting_target_revisions_require_review" in result["reasons"]
    assert "value" not in result


def test_status_and_population_are_separate_experiments(observation):
    estimated = revision(observation, "estimate", status="estimate")
    final = revision(observation, "final", status="final", status_basis="Test source explicitly identifies final data.")
    domestic = next(r for r in sample() if r["observation_id"] == "tet-2024-vn-domestic-lodging")
    international = revision(domestic, "international", population="international_lodging_guests")
    report = inspect_observations([observation, estimated, final, domestic, international])
    assert len(report["series"]) == 5
    assert report["distinct_region_windows_across_metrics"] == 2
    assert {s["status"] for s in report["series"]} == {"estimate", "reported", "final"}


def test_boundary_versions_are_never_joined(observation):
    before = revision(observation, "pre-boundary", region_id="VN-KH", boundary_id="VN-KH-pre-2025-07",
                      boundary_valid_through="2025-06-30")
    after = revision(before, "post-boundary", boundary_id="VN-KH-post-2025-07",
                     boundary_valid_from="2025-07-01", boundary_valid_through=None,
                     holiday_window_start="2025-08-30", holiday_window_end="2025-09-02",
                     window_start="2025-08-30", window_end="2025-09-02", published_at="2025-09-02")
    assert len(inspect_observations([before, after])["series"]) == 2
    before["boundary_valid_through"] = "2024-09-01"
    with pytest.raises(ValueError, match="crosses"):
        validate_observation(before)


def test_publication_day_is_not_available_at_start_of_that_day(observation):
    assert inspect_observations([observation], as_of="2024-09-03")["available_rows"] == 0
    assert inspect_observations([observation], as_of="2024-09-04")["available_rows"] == 1


def test_unknown_publication_date_is_visible_and_excluded_as_of(observation):
    unknown = revision(observation, "unknown-date", published_at=None, publication_date_basis="unknown")
    report = inspect_observations([unknown])
    assert "unknown_publication_dates_block_as_of_evaluation" in report["series"][0]["reasons"]
    dated = inspect_observations([unknown], as_of="2026-09-27")
    assert dated["as_of_excluded_rows"] == {"unknown_publication_date": 1}


def test_early_estimate_is_not_a_completed_target(observation):
    early = revision(observation, "early-estimate", status="estimate", published_at="2024-09-01")
    report = inspect_observations([early], as_of="2024-09-02")
    assert report["available_rows"] == 0
    assert report["as_of_excluded_rows"] == {"window_not_completed_before_as_of_day": 1}
    early["status"] = "final"
    with pytest.raises(ValueError, match="before window end"):
        validate_observation(early)


@pytest.mark.parametrize("updates", [
    {"metric": "lodging_guest_visits", "unit": "visitor_visits", "population": "all_visitors"},
    {"window_end": "2024-09-04"},
    {"window_start": "2024-09-03", "window_end": "2024-09-01"},
    {"published_at": "2024-02-30"},
    {"published_at": "2026-09-28"},
    {"source_url": "http://example.gov.vn/report"},
    {"source_url": "https://user:password@example.gov.vn/report"},
    {"source_locator": ""},
    {"timezone": "UTC"},
    {"boundary_id": "unspecified"},
    {"status": "official"},
])
def test_invalid_scope_or_provenance_is_rejected(observation, updates):
    observation.update(updates)
    with pytest.raises(ValueError):
        validate_observation(observation)


@pytest.mark.parametrize("measurement", [
    {"kind": "point", "value": True, "qualifier": "as_reported"},
    {"kind": "point", "value": float("nan"), "qualifier": "as_reported"},
    {"kind": "point", "value": 100.1, "qualifier": "as_reported"},
    {"kind": "range", "lower": 50, "upper": 45, "qualifier": "approximate"},
    {"kind": "range", "lower": 45, "upper": 50, "value": 47.5, "qualifier": "approximate"},
    {"kind": "lower_bound", "lower": 60, "inclusive": 0, "qualifier": "as_reported"},
])
def test_invalid_or_manufactured_measurements_are_rejected(observation, measurement):
    observation["measurement"] = measurement
    with pytest.raises(ValueError):
        validate_observation(observation)


def test_duplicate_ids_and_empty_input_are_rejected(observation):
    with pytest.raises(ValueError, match="unique"):
        inspect_observations([observation, observation])
    with pytest.raises(ValueError, match="nonempty"):
        inspect_observations([])


def test_coverage_screen_never_claims_a_trained_model(observation):
    rows = []
    for year in (2022, 2023, 2024):
        rows.append(revision(observation, f"year-{year}",
                             holiday_window_start=f"{year}-08-31", holiday_window_end=f"{year}-09-03",
                             window_start=f"{year}-08-31", window_end=f"{year}-09-03",
                             published_at=f"{year}-09-04"))
    report = inspect_observations(rows, minimum_windows=3, minimum_years=3)
    assert report["series"][0]["screening_status"] == "eligible_for_benchmark_design"
    assert report["model_trained"] is False


def test_source_flags_block_coverage_only_success(observation):
    observation["review_flags"] = ["Conflicting period description in another source"]
    result = inspect_observations([observation], 1, 1)["series"][0]
    assert result["screening_status"] == "needs_more_data_or_review"
    assert "source_review_flags_unresolved" in result["reasons"]


def test_cli_writes_report_and_does_not_modify_dataset(tmp_path):
    source = tmp_path / "source.json"
    source.write_bytes(SAMPLE.read_bytes())
    original = source.read_bytes()
    output = tmp_path / "report.json"
    run = subprocess.run([sys.executable, "-m", "app.training.vietnam_holiday_data", str(source),
                          "--output", str(output), "--as-of", "2024-09-04"],
                         cwd=ROOT, capture_output=True, text=True, check=True)
    report = json.loads(output.read_text(encoding="utf-8"))
    assert json.loads(run.stdout) == report
    assert report["available_rows"] == 9
    assert source.read_bytes() == original
    refused = subprocess.run([sys.executable, "-m", "app.training.vietnam_holiday_data", str(source),
                              "--output", str(source)], cwd=ROOT, capture_output=True, text=True)
    assert refused.returncode == 2
    assert source.read_bytes() == original
