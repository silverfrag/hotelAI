from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from app.training.academic_baselines import CalendarRuleBaseline, SeasonalRoomMedianBaseline
from app.training.academic_contract import (FEATURES, COLUMN_REVIEW, date_features,
    prepare_dataset, temporal_partitions)
from app.training.academic_training import preprocessing

DATA = Path(__file__).resolve().parents[1]/"notebooks/hotel_bookings.csv"


def test_source_contract_and_outcome_columns_cannot_enter_features(tmp_path):
    raw = pd.read_csv(DATA,nrows=80).drop_duplicates().head(20)
    first, second = tmp_path/"first.csv", tmp_path/"second.csv"
    raw.to_csv(first,index=False)
    raw["is_canceled"] = 1-raw.is_canceled
    raw["reservation_status"] = "No-Show"
    raw["assigned_room_type"] = "LEAK"
    raw["booking_changes"] = 999
    raw["total_of_special_requests"] = 999
    raw["adr"] = 999999
    raw.to_csv(second,index=False)
    a, _ = prepare_dataset(first)
    b, _ = prepare_dataset(second)
    pd.testing.assert_frame_equal(a.loc[:,FEATURES],b.loc[:,FEATURES])
    assert not set(FEATURES) & {"is_canceled","reservation_status","reservation_status_date","adr",
        "occupancy_ratio","booking_velocity_score","assigned_room_type","booking_changes"}
    assert set(pd.read_csv(first).columns) == set(COLUMN_REVIEW)


def test_label_maturity_is_purged_at_each_boundary():
    frame = pd.DataFrame({"row_id":list("abcdef"),
        "creation_date":pd.to_datetime(["2016-01-01","2016-02-01","2016-08-01","2016-09-01","2017-02-01","2017-03-01"]),
        "cancellation_label_available_at":pd.to_datetime(["2016-03-01","2016-08-01","2016-10-01","2017-02-01","2017-04-01","2017-10-01"])})
    parts, audit = temporal_partitions(frame,"cancellation")
    assert [parts[k].row_id.tolist() for k in ("train","validation","test")] == [["a"],["c"],["e"]]
    assert all(audit[k]["purged_unmatured_labels"]==1 for k in audit)


def test_preprocessing_is_fitted_on_training_only_and_handles_unknown():
    frame,_ = prepare_dataset(DATA)
    train = frame.head(30).loc[:,FEATURES].copy()
    train["children"] = [np.nan]+[2.0]*29
    transform = preprocessing().fit(train)
    held = train.head(1).copy()
    held["children"] = 9999
    held["reserved_room_type"] = "NEW-UNSEEN"
    values = transform.transform(held)
    assert np.isfinite(values).all()
    imputer = transform.named_transformers_["numeric"].named_steps["impute"]
    assert imputer.statistics_[list(train.columns[:9]).index("children")] == 2


def test_baselines_use_training_aggregates_and_unknown_fallback():
    X = pd.DataFrame({"hotel":["Resort Hotel"]*2,"reserved_room_type":["A"]*2,
        "arrival_month":[1,1],"arrival_day":[1,2],"weekend_share":[0.,1.]})
    y = np.array([50.,150.])
    calendar = CalendarRuleBaseline().fit(X,y)
    assert calendar.predict(X).tolist() == pytest.approx([110.,110.])
    seasonal = SeasonalRoomMedianBaseline().fit(X,y)
    unknown = X.copy(); unknown["reserved_room_type"]="Z"
    assert seasonal.predict(unknown).tolist()==[100.,100.]
    assert date_features(date(2017,1,6),3)["weekend_share"] == pytest.approx(2/3)


def test_real_dataset_split_is_disjoint_and_labels_are_known():
    frame, quality = prepare_dataset(DATA)
    assert quality["source_rows"]==119390
    assert quality["exact_duplicate_rows_removed"]==31994
    for task in ("adr","cancellation"):
        parts,audit = temporal_partitions(frame,task)
        ids = [set(parts[n].row_id) for n in ("train","validation","test")]
        assert not ids[0]&ids[1] and not ids[0]&ids[2] and not ids[1]&ids[2]
        for name, part in parts.items():
            assert (part[f"{task}_label_available_at"]<=pd.Timestamp(audit[name]["label_cutoff"])).all()
        assert parts["train"].creation_date.max()<parts["validation"].creation_date.min()
        assert parts["validation"].creation_date.max()<parts["test"].creation_date.min()
