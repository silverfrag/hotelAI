from datetime import date

import pytest

from app.core.vietnam_calendar import (
    build_vietnam_calendar_features,
    calculate_vietnam_demand_score,
    is_vietnam_holiday,
)


def test_tet_break_ends_on_february_22_and_distinguishes_statutory_days() -> None:
    features = build_vietnam_calendar_features(date(2026, 2, 14), 9)
    assert features["public_holiday_nights"] == 5
    assert features["public_sector_break_nights"] == 9
    assert is_vietnam_holiday(date(2026, 2, 22))[0] is True
    assert is_vietnam_holiday(date(2026, 2, 23))[0] is False


def test_holiday_on_checkout_is_excluded() -> None:
    assert build_vietnam_calendar_features(date(2026, 4, 29), 1)["public_holiday_nights"] == 0
    assert build_vietnam_calendar_features(date(2026, 4, 29), 2)["public_holiday_nights"] == 1


def test_national_day_does_not_invent_a_third_public_holiday() -> None:
    features = build_vietnam_calendar_features(date(2026, 8, 29), 6)
    assert features["public_holiday_nights"] == 2
    assert features["public_sector_break_nights"] == 5
    assert is_vietnam_holiday(date(2026, 9, 3))[0] is False


def test_weekend_extension_is_separate_from_statutory_holiday() -> None:
    features = build_vietnam_calendar_features(date(2026, 5, 2), 1)
    assert features["public_holiday_nights"] == 0
    assert features["public_sector_break_nights"] == 1


def test_culture_day_is_enacted_but_extended_break_is_still_proposed() -> None:
    features = build_vietnam_calendar_features(date(2026, 11, 21), 4)
    assert features["public_holiday_nights"] == 1
    assert features["public_sector_break_nights"] == 0
    assert is_vietnam_holiday(date(2026, 11, 23))[0] is False


@pytest.mark.parametrize("day", [date(2026, 12, 24), date(2026, 12, 25), date(2026, 12, 31)])
def test_year_end_observances_are_not_public_holidays(day: date) -> None:
    assert is_vietnam_holiday(day)[0] is False


@pytest.mark.parametrize("check_in,nights", [(date(2027, 2, 6), 1), (date(2026, 12, 31), 2)])
def test_unknown_calendar_coverage_is_explicit(check_in: date, nights: int) -> None:
    with pytest.raises(ValueError, match="unverified"):
        build_vietnam_calendar_features(check_in, nights)


def test_date_facts_have_no_fake_demand_and_demo_output_is_labeled() -> None:
    features = build_vietnam_calendar_features(date(2026, 7, 1), 2)
    assert "season_multiplier" not in features
    assert "combined_market_factor" not in features
    assert features["regional_events_status"] == "property_location_unconfigured"
    assert calculate_vietnam_demand_score(date(2026, 7, 1), 2)["signal_provenance"] == "synthetic_demo_heuristic"


@pytest.mark.parametrize("nights", [0, -1, 1.5, True])
def test_invalid_stay_length_is_rejected(nights: int) -> None:
    with pytest.raises(ValueError, match="positive integer"):
        build_vietnam_calendar_features(date(2026, 1, 1), nights)
