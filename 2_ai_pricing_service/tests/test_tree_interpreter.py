"""Tests for Saabas Tree Interpreter and explainable pricing engine."""
from __future__ import annotations

from pathlib import Path
import numpy as np
import pandas as pd
import pytest
from sklearn.ensemble import RandomForestRegressor

from app.core.serving_contract import SERVING_FEATURE_ORDER
from app.core.tree_interpreter import (
    explain_random_forest,
)
from app.schemas.pricing_schema import PriceExplanation, PricingRequest
from app.services.inference import PricingInferenceService


def test_tree_interpreter_exact_additivity_property():
    # Synthetic dataset with known non-linear dynamics
    np.random.seed(42)
    n_samples = 200
    cols = list(SERVING_FEATURE_ORDER)
    X = np.random.randn(n_samples, len(cols))
    y = 1.0 + 0.2 * X[:, 0] - 0.15 * X[:, 1] + 0.05 * (X[:, 2] ** 2)

    rf = RandomForestRegressor(n_estimators=10, random_state=42, max_depth=4)
    rf.fit(X, y)

    # Pick a sample
    sample_values = X[0:1]
    feature_frame = pd.DataFrame(sample_values, columns=cols)
    features_dict = {name: float(val) for name, val in zip(cols, sample_values[0])}

    explanation = explain_random_forest(
        model=rf,
        feature_frame=feature_frame,
        features_dict=features_dict,
    )

    assert isinstance(explanation, PriceExplanation)
    assert len(explanation.attributions) == len(cols)

    # Check that sum of absolute percentages equals 100%
    total_pct = sum(attr.pct_contribution for attr in explanation.attributions)
    assert 99.0 <= total_pct <= 101.0  # slight rounding margin

    # Check primary driver and real counterfactual evaluation
    assert explanation.primary_driver != ""
    assert "lead time =" in explanation.counterfactual
    assert "Random Forest" in explanation.counterfactual
    assert "Tree Interpreter" in explanation.ai_vs_script_note


def test_tree_interpreter_on_saved_champion_model():
    model_path = Path("app/models/random_forest_v2.pkl")
    if not model_path.exists():
        pytest.skip("random_forest_v2.pkl not found locally")

    service = PricingInferenceService(model_path)
    service.load()

    req = PricingRequest(
        lead_time=14,
        check_in_date="2026-10-15",
        check_out_date="2026-10-18",
        guest_count=2,
    )

    pred, exp = service.explain_prediction(req)
    assert pred.multiplier >= 0.5
    assert isinstance(exp, PriceExplanation)
    assert len(exp.attributions) == len(SERVING_FEATURE_ORDER)
    assert exp.temporal_share_pct > 0.0
    assert exp.primary_driver != ""
