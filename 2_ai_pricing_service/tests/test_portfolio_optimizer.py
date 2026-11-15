"""Unit and API tests for E3 OR-Tools CP-SAT Multi-Night Portfolio Yield Optimizer."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.services.portfolio_yield_optimizer import PortfolioTierInput, PortfolioYieldOptimizer


def _whitesand_tiers(horizon: int, superior_avail: int = 12, deluxe_avail: int = 12) -> list[PortfolioTierInput]:
    return [
        PortfolioTierInput(1, "Superior Room", 1_200_000, 1_550_000, 12, [superior_avail] * horizon),
        PortfolioTierInput(2, "Deluxe Room", 1_400_000, 1_700_000, 12, [deluxe_avail] * horizon),
        PortfolioTierInput(3, "Premium Room", 1_600_000, 1_850_000, 8, [8] * horizon),
        PortfolioTierInput(4, "Executive Room", 1_700_000, 2_000_000, 8, [8] * horizon),
        PortfolioTierInput(5, "Suite", 1_800_000, 2_150_000, 8, [8] * horizon),
        PortfolioTierInput(6, "Studio Apartment", 2_000_000, 2_300_000, 6, [6] * horizon),
    ]


def test_portfolio_optimizer_enforces_monotonic_ladder_bounds_and_lift():
    optimizer = PortfolioYieldOptimizer()
    res = optimizer.optimize(
        tiers=_whitesand_tiers(4),
        start_date="2026-11-14",
        horizon_days=4,
        scenario_id="holiday_surge",
        price_elasticity=0.95,
        allow_cross_tier_upgrades=True,
    )
    assert res["status"] in ("OPTIMAL", "FEASIBLE")
    assert res["optimized_contribution_vnd"] >= res["static_baseline_contribution_vnd"]
    assert res["ml_cancel_source"] in ("ml_academic_v1", "prior_fallback")
    assert 0.0 < res["avg_ml_cancel_prob"] < 1.0

    by_night: dict[str, list[dict]] = {}
    for cell in res["decisions"]:
        assert cell["recommended_price_vnd"] >= res["contribution_floor_vnd"]
        assert cell["recommended_price_vnd"] <= cell["declared_max_price_vnd"]
        by_night.setdefault(cell["stay_date"], []).append(cell)

    assert len(by_night) == 4
    for _, cells in by_night.items():
        ordered = sorted(cells, key=lambda c: c["type_id"])
        prices = [c["recommended_price_vnd"] for c in ordered]
        assert prices == sorted(prices), f"Monotonic tier ladder violated: {prices}"


def test_portfolio_optimizer_cross_tier_upgrade_and_shadow_price():
    optimizer = PortfolioYieldOptimizer()
    # Superior tightly bottlenecked (1 room left), Deluxe wide open (12 left) under high surge
    with_up = optimizer.optimize(
        tiers=_whitesand_tiers(2, superior_avail=1, deluxe_avail=12),
        start_date="2026-11-14",
        horizon_days=2,
        scenario_id="holiday_surge",
        price_elasticity=0.90,
        allow_cross_tier_upgrades=True,
    )
    no_up = optimizer.optimize(
        tiers=_whitesand_tiers(2, superior_avail=1, deluxe_avail=12),
        start_date="2026-11-14",
        horizon_days=2,
        scenario_id="holiday_surge",
        price_elasticity=0.90,
        allow_cross_tier_upgrades=False,
    )
    assert with_up["total_upgraded_room_nights"] > 0
    assert no_up["total_upgraded_room_nights"] == 0
    assert with_up["optimized_contribution_vnd"] >= no_up["optimized_contribution_vnd"]

    sup_shadow = next(sp for sp in with_up["shadow_prices"] if sp["type_id"] == 1)
    assert sup_shadow["marginal_value_vnd_per_room"] > 0


def test_portfolio_optimize_fastapi_endpoint():
    with TestClient(app) as client:
        resp = client.post(
            "/api/v1/revenue/portfolio-optimize",
            json={
                "start_date": "2026-11-15",
                "horizon_days": 3,
                "scenario_id": "weekend_high",
                "price_elasticity": 1.15,
                "allow_cross_tier_upgrades": True,
                "tiers": [
                    {
                        "type_id": t.type_id,
                        "type_name": t.type_name,
                        "base_price": t.base_price,
                        "declared_max_price": t.declared_max_price,
                        "sellable_rooms": t.sellable_rooms,
                        "nightly_available": t.nightly_available,
                    }
                    for t in _whitesand_tiers(3)
                ],
            },
        )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["shadow_prices"]) == 6
    assert len(body["decisions"]) == 18

