"""Train a context-aware model from reviewed, resolved quote exposures only.

CLI: python -m app.training.market_conversion_training --data observations.jsonl
     --snapshots .tmp/market-decisions --output app/models/danang_market_v1

No generated labels, cancellation-as-conversion, or legacy synthetic artifact
promotion. Snapshots are hashed engine outputs. Outcome events must be exported
from the real exposure ledger and reviewed; a flag is an operator attestation,
not proof independently recoverable from a CSV.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from app.core.market_feature_contract import FEATURES, VERSION
from app.services.market_context import CONTEXT_VERSION


def load_observations(path, snapshots):
    records, seen, events = [], set(), set()
    for line in Path(path).read_text(encoding="utf8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if (row.get("provenance") != "observed" or row.get("reviewed") is not True
            or row.get("exposure_confirmed") is not True or type(row.get("accepted")) is not int or row["accepted"] not in (0, 1)
            or not row.get("outcome_event_id") or not row.get("exposure_event_id")):
            raise ValueError("Every label must be a reviewed observed, resolved quote exposure")
        quote_id = row["quote_id"]
        if quote_id in seen:
            raise ValueError("Duplicate quote exposure")
        seen.add(quote_id)
        event_ids = {row["exposure_event_id"], row["outcome_event_id"]}
        if len(event_ids) != 2 or events.intersection(event_ids):
            raise ValueError("Reused or conflicting ledger event IDs")
        events.update(event_ids)
        digest = row["decision_id"]
        if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise ValueError("Invalid decision ID")
        raw = (Path(snapshots) / f"{digest}.json").read_bytes()
        if hashlib.sha256(raw).hexdigest() != digest:
            raise ValueError("Decision snapshot checksum mismatch")
        snapshot = json.loads(raw)
        if (snapshot["feature_contract_version"] != VERSION or snapshot["region"] != "VN-DN"
            or snapshot["context"]["extractor_version"] != CONTEXT_VERSION
            or snapshot["features"] is None):
            raise ValueError("Need matching context contract and complete evidence")
        # Join the collected market snapshot to an immutable, observed PMS quote.
        # A simulator snapshot alone is never sufficient to train the model.
        observed_quote = row.get("verified_pms_quote", {})
        if (observed_quote.get("provenance") != "observed" or observed_quote.get("quote_id") != quote_id
            or observed_quote.get("region") != "VN-DN" or observed_quote.get("currency") != "VND"
            or observed_quote.get("room_segment") != "upscale_resort_standard"
            or observed_quote.get("nightly_price") != row.get("offered_nightly_price")
            or any(observed_quote.get(key) != snapshot["request"][key] for key in
                   ("check_in_date", "guest_count", "base_price", "rooms_available", "rooms_total"))):
            raise ValueError("Market snapshot must match verified immutable PMS quote inventory/context")
        exposure = pd.Timestamp(row["exposed_at"])
        resolved = pd.Timestamp(row["resolved_at"])
        captured = pd.Timestamp(snapshot["created_at"])
        if exposure.tzinfo is None or resolved.tzinfo is None or not captured <= exposure <= resolved:
            raise ValueError("Invalid event order/timezone")
        if (exposure - captured).total_seconds() > 900 or resolved > pd.Timestamp.now(tz="UTC"):
            raise ValueError("Stale context at exposure or unresolved future outcome")
        offered = float(row["offered_nightly_price"])
        if not np.isfinite(offered) or offered <= 0:
            raise ValueError("Invalid observed offered price")
        features = snapshot["features"] | {"offered_price_ratio": offered / snapshot["request"]["base_price"]}
        records.append({**features, "accepted": row["accepted"], "quote_id": quote_id,
                        "exposed_at": exposure, "resolved_at": resolved,
                        "context_model": snapshot["context"]["model"]})
    frame = pd.DataFrame(records)
    if frame.empty or not np.isfinite(frame[list(FEATURES)].to_numpy(dtype=float)).all():
        raise ValueError("No finite observed feature vectors")
    if frame.context_model.fillna("none").nunique() != 1:
        raise ValueError("Do not mix different semantic extraction models in one training run")
    return frame.sort_values("exposed_at")


def fit_evaluate(frame, *, minimum_rows=500):
    """Temporal evaluation with maturity embargo; no balanced class weighting."""
    if len(frame) < minimum_rows or (frame.exposed_at.max() - frame.exposed_at.min()).days < 28:
        raise ValueError("Need at least 500 reviewed exposures spanning 28 days")
    cutoff = frame.iloc[int(len(frame) * .8)].exposed_at
    train = frame[(frame.exposed_at < cutoff) & (frame.resolved_at < cutoff)]
    test = frame[frame.exposed_at >= cutoff]
    if any(len(part) < 50 or part.accepted.nunique() != 2 or part.accepted.value_counts().min() < 20 for part in (train, test)):
        raise ValueError("Both chronological partitions need at least 20 examples of each outcome")
    if train.offered_price_ratio.nunique() < 5:
        raise ValueError("Insufficient observed price variation")
    model = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, C=.2, random_state=42))
    model.fit(train[list(FEATURES)], train.accepted)
    probability = model.predict_proba(test[list(FEATURES)])[:, 1]
    baseline = np.full(len(test), train.accepted.mean())
    brier = float(brier_score_loss(test.accepted, probability))
    loss = float(log_loss(test.accepted, probability))
    bins = []
    for lower in np.arange(0, 1, .1):
        mask = (probability >= lower) & (probability < lower + .1)
        if mask.any():
            bins.append({"rows": int(mask.sum()), "predicted": float(probability[mask].mean()),
                         "observed": float(test.accepted.to_numpy()[mask].mean())})
    ece = sum(b["rows"] * abs(b["predicted"] - b["observed"]) for b in bins) / len(test)
    negative_price = bool(model[-1].coef_[0][0] < 0)
    report = {"train_rows": len(train), "test_rows": len(test), "cutoff": cutoff.isoformat(),
        "maturity_embargo_rows": len(frame) - len(train) - len(test), "brier_score": brier, "log_loss": loss,
        "baseline_brier": float(brier_score_loss(test.accepted, baseline)),
        "baseline_log_loss": float(log_loss(test.accepted, baseline)),
        "auc": float(roc_auc_score(test.accepted, probability)), "calibration_bins": bins, "ece": ece,
        "negative_learned_price_coefficient": negative_price}
    report["passes_gate"] = bool(negative_price and brier < report["baseline_brier"] and loss < report["baseline_log_loss"] and ece <= .10)
    domain = {f: {"min": float(train[f].min()), "max": float(train[f].max())} for f in FEATURES}
    return model, report, domain


def train_artifact(data, snapshots, output):
    frame = load_observations(data, snapshots)
    model, evaluation, domain = fit_evaluate(frame)
    metadata = {"feature_contract_version": VERSION, "features": list(FEATURES), "region": "VN-DN",
        "room_segment": "upscale_resort_standard", "lifecycle": "shadow_only",
        "provenance": "reviewed_observed_exposures", "evaluation": evaluation, "domain": domain,
        "context_version": CONTEXT_VERSION, "context_model": frame.iloc[0].context_model,
        "training_data_sha256": hashlib.sha256(Path(data).read_bytes()).hexdigest(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "caveat": "Observational response, not causal price elasticity or demonstrated revenue uplift."}
    target = Path(output)
    if target.exists():
        raise ValueError("Choose a new version directory; existing models are never overwritten")
    target.mkdir(parents=True)
    (target / "report.json").write_text(json.dumps(metadata, indent=2), encoding="utf8")
    if not evaluation["passes_gate"]:
        return {"status": "rejected", "report": str(target / "report.json"), "evaluation": evaluation}
    joblib.dump({"model": model, "metadata": metadata}, target / "model.joblib")
    checksums = {name: hashlib.sha256((target / name).read_bytes()).hexdigest() for name in ("model.joblib", "report.json")}
    (target / "manifest.json").write_text(json.dumps(checksums), encoding="utf8")
    return {"status": "shadow_artifact_written", "path": str(target), "evaluation": evaluation}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--snapshots", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    print(json.dumps(train_artifact(args.data, args.snapshots, args.output), indent=2))
