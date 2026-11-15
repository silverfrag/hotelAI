from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.services.bandit_pricing_lab import BanditPricingLabService


def test_conversion_taxonomy_audit_detects_legacy_drift():
    svc = BanditPricingLabService()
    audit = svc.inspect_conversion_taxonomy(
        ["Superior Room", "Deluxe Room", "Premium Room", "Executive Room", "Suite", "Studio Apartment"]
    )
    assert audit["artifact_found"] is True
    assert audit["has_taxonomy_drift"] is True
    assert audit["taxonomy_overlap_pct"] == 0.0
    assert len(audit["unseen_live_room_types"]) == 6
    assert len(audit["legacy_artifact_only_types"]) == 8
    assert audit["promotion_allowed"] is False


def test_bandit_simulation_guardrails_and_regret():
    svc = BanditPricingLabService()
    res = svc.simulate_bandit_benchmark(
        room_type_id=1,
        room_type_name="Superior Room",
        base_price=1_200_000.0,
        declared_max_price=1_650_000.0,
        scenario_id="weekend_high",
        true_price_elasticity=1.25,
        episodes=300,
        seed=42,
    )
    assert res["automatic_promotion"] is False
    assert "SIMULATED_POLICY_BENCHMARK" in res["provenance"]
    summaries = {item["policy_id"]: item for item in res["policy_summaries"]}
    ts = summaries["guardrailed_thompson_sampling"]
    eg = summaries["unconstrained_epsilon_greedy"]
    assert ts["safety_compliance_pct"] == 100.0
    assert ts["floor_violations"] == 0 and ts["ceiling_violations"] == 0
    assert (eg["floor_violations"] + eg["ceiling_violations"]) > 0
    assert len(res["thompson_arms"]) >= 3
    for arm in res["thompson_arms"]:
        assert res["guardrails"]["contribution_floor_vnd"] <= arm["price_vnd"] <= res["guardrails"]["declared_ceiling_vnd"]
    assert len(res["regret_series"]) >= 10
    assert res["regret_series"][-1]["episode"] == 300


def test_bandit_fastapi_endpoints():
    client = TestClient(app)
    r_tax = client.get("/api/v1/revenue/taxonomy-audit")
    assert r_tax.status_code == 200
    assert r_tax.json()["promotion_allowed"] is False

    r_sim = client.post(
        "/api/v1/revenue/bandit-simulate",
        json={"room_type_id": 2, "room_type_name": "Deluxe Room", "base_price": 1_400_000, "declared_max_price": 1_900_000, "episodes": 200},
    )
    assert r_sim.status_code == 200
    body = r_sim.json()
    assert body["episodes"] == 200
    assert body["taxonomy_audit"]["has_taxonomy_drift"] is True

