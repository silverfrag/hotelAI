"""Creation-intended retrospective contract; never claims creation snapshots exist.

Raw data are pre-arrival snapshots, not an event stream. The available booking
attributes below are user-enterable at creation, but their historical creation
values cannot be recovered. That limitation is part of every experiment.
"""
from __future__ import annotations

from datetime import date
import hashlib
from pathlib import Path

import numpy as np
import pandas as pd

CONTRACT_VERSION = "academic-booking-v1"
MONTHS = {name: i + 1 for i, name in enumerate((
    "January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December",
))}
CATEGORICAL = ("hotel", "reserved_room_type", "meal", "market_segment",
               "distribution_channel", "customer_type")
NUMERIC = ("lead_time", "arrival_month", "arrival_day", "arrival_weekday", "stay_nights",
           "weekend_share", "adults", "children", "babies")
FEATURES = (*NUMERIC, *CATEGORICAL)
CAVEATS = [
    "Public Portuguese hotel data, arrivals 2015–2017; Aurum is a simulated resort.",
    "ADR is a historical reference in original EUR units, not an optimal price or revenue uplift.",
    "Creation-intended retrospective proxy: source snapshots are near arrival; initial attribute values are unavailable.",
    "Creation date is derived from arrival minus lead_time; mutable arrival/lead_time can affect this proxy.",
    "The arrival-window cohort is truncated; results do not represent every booking created in each month.",
    "is_canceled includes No-Show; cancellation risk is not quote conversion or causal price elasticity.",
    "Explanation changes show model associations, not causal effects.",
]
# Every raw column is assigned an explicit role; new CSV columns fail review.
COLUMN_REVIEW = {
    "hotel": "input: anonymized property category; never a Vietnam property identifier",
    "is_canceled": "classification target / regression cohort filter only; never X",
    "lead_time": "input: creation-intended advance interval; snapshot-stability assumption",
    "arrival_date_year": "date construction/split only; not a numeric trend predictor",
    "arrival_date_month": "input: planned arrival month; mutable snapshot caveat",
    "arrival_date_week_number": "excluded: redundant calendar representation",
    "arrival_date_day_of_month": "input: planned date -> weekday; mutable snapshot caveat",
    "stays_in_weekend_nights": "input: planned stay total only; recompute weekend share from date",
    "stays_in_week_nights": "input: planned stay total; mutable snapshot caveat",
    "adults": "input: declared guests; mutable snapshot caveat",
    "children": "input: declared guests; missing stays missing for train-only imputation",
    "babies": "input: declared guests; mutable snapshot caveat",
    "meal": "input: selected meal; mutable snapshot caveat",
    "country": "excluded: nationality may be confirmed at check-in; no identity proxy",
    "market_segment": "input: booking acquisition context; snapshot caveat",
    "distribution_channel": "input: booking acquisition channel; snapshot caveat",
    "is_repeated_guest": "excluded: guest history cannot be verified as-of creation",
    "previous_cancellations": "excluded: history timestamps unavailable",
    "previous_bookings_not_canceled": "excluded: history timestamps unavailable",
    "reserved_room_type": "input: reserved anonymized code; no invented luxury-room mapping",
    "assigned_room_type": "excluded: operational assignment after initial request",
    "booking_changes": "excluded: accumulates after creation",
    "deposit_type": "excluded: deposit timing and policy assignment not verified as-of creation",
    "agent": "excluded: sparse anonymized ID, not an appropriate demo feature",
    "company": "excluded: sparse anonymized ID, not an appropriate demo feature",
    "days_in_waiting_list": "excluded: future waiting duration",
    "customer_type": "input: declared booking party type; mutable snapshot caveat",
    "adr": "regression target only; excluded from cancellation X and ADR X",
    "required_car_parking_spaces": "excluded: request may be added after creation",
    "total_of_special_requests": "excluded: requests may accumulate after creation",
    "reservation_status": "outcome/cohort sanity check only; never X",
    "reservation_status_date": "label maturity metadata only; never X",
}


def date_features(arrival: date, stay_nights: int) -> dict[str, float | int]:
    full, rest = divmod(stay_nights, 7)
    weekends = full * 2 + sum((arrival.weekday() + i) % 7 >= 5 for i in range(rest))
    return {"arrival_month": arrival.month, "arrival_day": arrival.day, "arrival_weekday": arrival.weekday(),
            "stay_nights": stay_nights, "weekend_share": weekends / stay_nights}


def prepare_dataset(path: Path) -> tuple[pd.DataFrame, dict]:
    raw = pd.read_csv(path)
    if set(raw) != set(COLUMN_REVIEW):
        raise ValueError(f"CSV columns need review: missing={set(COLUMN_REVIEW)-set(raw)}, extra={set(raw)-set(COLUMN_REVIEW)}")
    # No booking IDs exist. Unique-record analysis avoids exact repeated records
    # across folds but may collapse legitimate group bookings; report this choice.
    unique = raw.drop_duplicates().copy()
    unique["row_id"] = [f"booking-{i}" for i in unique.index]
    arrival = pd.to_datetime(dict(year=unique.arrival_date_year,
        month=unique.arrival_date_month.map(MONTHS), day=unique.arrival_date_day_of_month), errors="coerce")
    unique["arrival_date"] = arrival
    unique["creation_date"] = arrival - pd.to_timedelta(unique.lead_time, unit="D")
    nights = unique.stays_in_weekend_nights + unique.stays_in_week_nights
    unique["stay_nights"] = nights
    unique["arrival_month"] = arrival.dt.month
    unique["arrival_day"] = arrival.dt.day
    unique["arrival_weekday"] = arrival.dt.weekday
    unique["weekend_share"] = [date_features(a.date(), int(n))["weekend_share"]
        if pd.notna(a) and n > 0 else np.nan for a, n in zip(arrival, nights)]
    status_date = pd.to_datetime(unique.reservation_status_date, errors="coerce")
    checkout = arrival + pd.to_timedelta(nights, unit="D")
    # Date precision is daily: add one day before declaring outcome available.
    unique["cancellation_label_available_at"] = status_date + pd.Timedelta(days=1)
    unique["adr_label_available_at"] = pd.concat([status_date, checkout], axis=1).max(axis=1) + pd.Timedelta(days=1)
    valid = (arrival.notna() & status_date.notna() & (nights > 0)
        & (unique.lead_time >= 0) & (unique.adults >= 1)
        & (unique.children.isna() | (unique.children >= 0)) & (unique.babies >= 0)
        & (status_date >= unique.creation_date) & unique.is_canceled.isin([0, 1]))
    frame = unique.loc[valid].copy()
    report = {
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "source_rows": len(raw),
        "exact_duplicate_rows_removed": len(raw)-len(unique), "invalid_context_rows_removed": int((~valid).sum()),
        "eligible_rows": len(frame), "hotel_counts": frame.hotel.value_counts().to_dict(),
        "missing": {k:int(v) for k,v in raw.isna().sum().items() if v},
        "adr_quantiles": {str(k):float(v) for k,v in raw.adr.quantile([0,.01,.5,.95,.99,1]).items()},
        "adr_nonpositive_rows": int((raw.adr <= 0).sum()),
        "duplicate_policy": "unique raw records; may collapse real identical group bookings; no identity-level deduplication claim",
        "column_review": COLUMN_REVIEW, "caveats": CAVEATS,
    }
    return frame, report


def temporal_partitions(frame: pd.DataFrame, task: str, validation_start="2016-07-01",
                        test_start="2017-01-01", evaluation_as_of="2017-09-16"):
    if task not in {"adr", "cancellation"}:
        raise ValueError("Unknown target")
    start, end, asof = map(pd.Timestamp, (validation_start, test_start, evaluation_as_of))
    if not start < end < asof:
        raise ValueError("Require validation_start < test_start < evaluation_as_of")
    data = frame.copy()
    if task == "adr":
        data = data.loc[(data.is_canceled == 0) & (data.reservation_status == "Check-Out")
                        & np.isfinite(data.adr) & (data.adr > 0)].copy()
    label = f"{task}_label_available_at"
    windows = {"train": (data.creation_date < start, start),
               "validation": ((data.creation_date >= start) & (data.creation_date < end), end),
               "test": (data.creation_date >= end, asof)}
    parts, audit = {}, {}
    for name, (mask, cutoff) in windows.items():
        known = data[label] <= cutoff
        part = data.loc[mask & known].sort_values(["creation_date", "row_id"]).copy()
        if part.empty:
            raise ValueError(f"Empty {task} {name} partition")
        parts[name] = part
        audit[name] = {"rows":len(part), "purged_unmatured_labels":int((mask & ~known).sum()),
            "creation_range":[str(part.creation_date.min().date()),str(part.creation_date.max().date())],
            "latest_label_available":str(part[label].max().date()), "label_cutoff":str(cutoff.date())}
    return parts, audit
