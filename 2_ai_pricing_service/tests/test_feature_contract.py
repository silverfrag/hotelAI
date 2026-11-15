from datetime import date

import pandas as pd
import pytest

from app.core.feature_contract import (
    FEATURE_ORDER,
    build_pricing_features,
    count_weekend_nights,
    stay_includes_weekend_night,
)
from app.core.serving_contract import SERVING_FEATURE_ORDER, build_serving_features
from notebooks.train_model import (
    ARRIVAL_DATE_COLUMN,
    TrainingConfig,
    chronological_split,
    engineer_features,
    train_and_evaluate,
)


@pytest.mark.parametrize(
    "check_in,check_out,expected",
    [
        (date(2026, 8, 10), date(2026, 8, 14), 0),  # Monday through Thursday nights
        (date(2026, 8, 14), date(2026, 8, 15), 0),  # Friday night only
        (date(2026, 8, 15), date(2026, 8, 16), 1),  # Saturday night
        (date(2026, 8, 16), date(2026, 8, 17), 1),  # Sunday night
        (date(2026, 8, 14), date(2026, 8, 17), 1),  # Weekend inside the stay
        (date(2026, 8, 10), date(2026, 8, 17), 1),  # Every seven-night stay
    ],
)
def test_weekend_feature_covers_the_complete_stay(
    check_in: date,
    check_out: date,
    expected: int,
) -> None:
    assert stay_includes_weekend_night(check_in, check_out) == expected


def test_weekend_feature_rejects_empty_or_backward_stays() -> None:
    with pytest.raises(ValueError, match="check_out must be after check_in"):
        stay_includes_weekend_night(date(2026, 8, 14), date(2026, 8, 14))


def test_serving_feature_builder_uses_model_order_and_full_stay() -> None:
    features = build_serving_features(
        lead_time=21,
        check_in=date(2026, 8, 14),
        check_out=date(2026, 8, 17),
        guest_count=2,
    )

    assert tuple(features) == SERVING_FEATURE_ORDER
    assert features == {
        "lead_time": 21,
        "arrival_month_sin": -0.5,
        "arrival_month_cos": -0.8660254038,
        "arrival_weekday_sin": -0.4338837391,
        "arrival_weekday_cos": -0.9009688679,
        "stay_nights": 3,
        "weekend_nights": 2,
        "weekend_share": 0.6666666667,
        "guest_count": 2,
    }


def test_weekend_count_handles_stays_longer_than_one_week() -> None:
    assert count_weekend_nights(date(2026, 8, 10), date(2026, 8, 24)) == 4


def test_training_maps_weekend_night_count_to_same_binary_contract() -> None:
    raw = pd.DataFrame(
        {
            "hotel": ["City Hotel"] * 4,
            "is_canceled": [0] * 4,
            "adr": [100.0, 120.0, 80.0, 110.0],
            "lead_time": [1, 2, 3, 4],
            "arrival_date_year": [2026] * 4,
            "arrival_date_month": ["August"] * 4,
            "arrival_date_day_of_month": [10, 11, 12, 13],
            "stays_in_weekend_nights": [0, 1, 2, 0],
            "stays_in_week_nights": [1, 1, 1, 1],
            "adults": [2, 2, 2, 2],
            "children": [0, 0, 0, 0],
            "babies": [0, 0, 0, 0],
            "reserved_room_type": ["A", "A", "B", "B"],
            "total_of_special_requests": [0, 1, 2, 3],
        }
    )

    processed = engineer_features(raw)

    assert processed["is_weekend"].tolist() == [0, 1, 1, 0]
    assert processed["stay_nights"].tolist() == [1, 2, 3, 1]
    assert processed["guest_count"].tolist() == [2, 2, 2, 2]
    assert list(processed.columns) == [
        *FEATURE_ORDER,
        "arrival_month",
        "is_weekend",
        "total_of_special_requests",
        "reserved_room_type",
        ARRIVAL_DATE_COLUMN,
        "adr",
    ]


def test_chronological_split_keeps_a_date_in_only_one_partition() -> None:
    dates = pd.to_datetime(
        [
            "2026-01-01",
            "2026-01-02",
            "2026-01-03",
            "2026-01-03",
            "2026-01-04",
        ]
    )
    frame = pd.DataFrame({ARRIVAL_DATE_COLUMN: dates, "adr": [1, 2, 3, 4, 5]})

    training, holdout = chronological_split(frame, test_size=0.4)

    assert training[ARRIVAL_DATE_COLUMN].max() < holdout[ARRIVAL_DATE_COLUMN].min()
    assert set(training[ARRIVAL_DATE_COLUMN]).isdisjoint(holdout[ARRIVAL_DATE_COLUMN])


def test_training_is_deterministic_for_same_data_and_seed() -> None:
    dates = pd.date_range("2025-01-01", periods=40, freq="D")
    feature_rows = [
        build_pricing_features(
            lead_time=index,
            check_in=arrival.date(),
            check_out=(arrival + pd.Timedelta(days=(index % 5) + 1)).date(),
            guest_count=(index % 4) + 1,
        )
        for index, arrival in enumerate(dates)
    ]
    training_frame = pd.DataFrame(feature_rows)
    training_frame["arrival_month"] = dates.month
    training_frame["is_weekend"] = (training_frame["weekend_nights"] > 0).astype(int)
    training_frame["total_of_special_requests"] = [index % 6 for index in range(40)]
    training_frame["reserved_room_type"] = ["A" if index % 2 else "B" for index in range(40)]
    training_frame[ARRIVAL_DATE_COLUMN] = dates
    training_frame["adr"] = [75.0 + (index % 10) * 5 for index in range(40)]
    config = TrainingConfig(n_estimators=8, max_depth=4, n_jobs=1)

    first_model, first_evaluation = train_and_evaluate(training_frame, config)
    second_model, second_evaluation = train_and_evaluate(training_frame, config)

    assert first_evaluation == second_evaluation
    assert first_evaluation["split"]["strategy"] == "chronological_by_arrival_date"
    assert first_evaluation["target_reference"]["strategy"] == "training_reserved_room_type_median_adr"
    assert first_evaluation["split"]["training_date_range"][1] < first_evaluation["split"]["holdout_date_range"][0]
    assert first_model.predict(training_frame[list(FEATURE_ORDER)]).tolist() == pytest.approx(
        second_model.predict(training_frame[list(FEATURE_ORDER)]).tolist(),
        rel=0,
        abs=0,
    )
