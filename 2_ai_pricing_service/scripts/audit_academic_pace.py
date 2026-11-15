"""Audit whether the public snapshot can support observed booking pace as-of.

The cohort counts below are diagnostics, never model features or observed demand.
"""
import argparse
import hashlib
import json
from pathlib import Path

import pandas as pd


def audit(path):
    raw = pd.read_csv(path)
    frame = raw.drop_duplicates().copy()
    months = {name: i+1 for i, name in enumerate(('January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'))}
    arrival = pd.to_datetime(dict(year=frame.arrival_date_year,
        month=frame.arrival_date_month.map(months), day=frame.arrival_date_day_of_month))
    creation = arrival - pd.to_timedelta(frame.lead_time, unit='D')
    status = pd.to_datetime(frame.reservation_status_date)
    windows = []
    for cutoff in ('2016-07-01', '2017-01-01'):
        day = pd.Timestamp(cutoff)
        # Date-only precision: cancellation becomes known the next day, matching training.
        known_canceled = frame.is_canceled.eq(1) & ((status + pd.Timedelta(days=1)) <= day)
        in_cohort = (creation <= day) & (arrival >= day)
        windows.append({'as_of': cutoff, 'derived_created_future_arrival_records': int(in_cohort.sum()),
            'final_cancellations_already_known': int((in_cohort & known_canceled).sum()),
            'remaining_snapshot_proxy_records': int((in_cohort & ~known_canceled).sum()),
            'warning': 'Arrival-cohort snapshot proxy, not verified on-the-books inventory or demand.'})
    return {'data_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'source_rows': len(raw), 'unique_records': len(frame),
        'records_with_booking_changes': int(frame.booking_changes.gt(0).sum()),
        'cancellations_status_after_arrival': int((frame.is_canceled.eq(1) & (status > arrival)).sum()),
        'creation_proxy_range': [str(creation.min().date()), str(creation.max().date())],
        'arrival_cohort_range': [str(arrival.min().date()), str(arrival.max().date())],
        'as_of_diagnostics': windows, 'observed_pace_feature_accepted': False,
        'reasons': ['No stable booking ID or event history; identical group bookings may collapse.',
            'No creation timestamp or hourly events; creation is derived from mutable arrival/lead_time.',
            'Final arrival/room/stay values cannot reconstruct their historical values as-of.',
            'Arrival-window extraction omits bookings outside its cohort; daily creation counts are truncated.',
            'Final status/date allow a cancellation timing proxy, not the complete state transition history.',
            'No room inventory snapshots, so occupancy cannot be derived from booking counts.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, default=Path(__file__).resolve().parents[1]/'notebooks/hotel_bookings.csv')
    args = parser.parse_args()
    print(json.dumps(audit(args.data), indent=2))


if __name__ == '__main__':
    main()
