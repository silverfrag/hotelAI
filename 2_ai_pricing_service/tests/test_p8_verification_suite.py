"""Comprehensive P8 Verification Suite for HotelAI Intelligent Revenue Simulator."""
import pytest
from fastapi.testclient import TestClient
from app.academic_main import app

client = TestClient(app)


def test_1_scenarios_and_provenance_labels():
    resp = client.get("/api/v1/revenue/scenarios")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["scenarios"]) >= 4
    assert len(data["coupons"]) >= 4

    for s in data["scenarios"]:
        assert s["provenance"] == "SIMULATED_ASSUMPTION"
        assert s["demand_level"] in ("low", "normal", "high", "surge")
        assert s["weather"] in ("sunny_favorable", "stormy_unfavorable")
        assert s["serving_cost_per_night"] >= 200000.0


def test_2_quote_decision_and_four_sources():
    payload = {
        "room_type_id": 1,
        "room_type_name": "Deluxe King",
        "base_price": 1200000.0,
        "check_in_date": "2026-11-01",
        "check_out_date": "2026-11-03",
        "guest_count": 2,
        "rooms_available": 10,
        "rooms_total": 24,
        "ml_multiplier": 1.12,
        "scenario_id": "standard",
    }
    resp = client.post("/api/v1/revenue/decision", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_nights"] == 2
    assert data["base_price"] == 1200000.0
    assert data["guest_payable_nightly_rate"] > 0
    assert data["estimated_contribution_margin"] > 0

    sources = {f["source_category"] for f in data["factors"]}
    assert "(A) ML_REAL_DATA" in sources
    assert "(B) SIMULATED_SYSTEM_STATE" in sources
    assert "(C) SIMULATED_ASSUMPTION" in sources
    assert len(data["caveats"]) > 0


def test_3_coupon_valid_and_expired():
    # Valid coupon
    val_resp = client.post(
        "/api/v1/revenue/decision",
        json={
            "room_type_id": 1,
            "room_type_name": "Superior Room",
            "base_price": 1200000.0,
            "declared_max_price": 1550000.0,
            "check_in_date": "2026-11-01",
            "check_out_date": "2026-11-02",
            "guest_count": 2,
            "rooms_available": 6,
            "rooms_total": 12,
            "coupon_code": "WHITESAND10",
        },
    )
    assert val_resp.status_code == 200
    val_data = val_resp.json()
    assert val_data["coupon_applied"] == "WHITESAND10"
    assert val_data["coupon_discount_vnd"] > 0
    assert val_data["guest_payable_nightly_rate"] < val_data["scenario_recommended_rate"]

    # Expired coupon
    exp_resp = client.post(
        "/api/v1/revenue/decision",
        json={
            "room_type_id": 1,
            "room_type_name": "Superior Room",
            "base_price": 1200000.0,
            "check_in_date": "2026-11-01",
            "check_out_date": "2026-11-02",
            "guest_count": 2,
            "rooms_available": 6,
            "rooms_total": 12,
            "coupon_code": "EXPIRED50",
        },
    )
    assert exp_resp.status_code == 200
    exp_data = exp_resp.json()
    assert exp_data["coupon_applied"] is None
    assert any("hết hạn" in c for c in exp_data["caveats"])


def test_4_contribution_margin_floor_protection():
    floor_resp = client.post(
        "/api/v1/revenue/decision",
        json={
            "room_type_id": 1,
            "room_type_name": "Budget Room",
            "base_price": 400000.0,
            "check_in_date": "2026-11-01",
            "check_out_date": "2026-11-02",
            "guest_count": 2,
            "rooms_available": 6,
            "rooms_total": 12,
            "coupon_code": "SUITE20",
            "scenario_id": "standard",
        },
    )
    assert floor_resp.status_code == 200
    floor_data = floor_resp.json()
    assert floor_data["is_floor_price_clamped"] is True
    assert floor_data["estimated_contribution_margin"] >= 0
    assert any("RÀNG BUỘC KINH DOANH" in c for c in floor_data["caveats"])


def test_5_ortools_cp_sat_zero_oversell_and_priority():
    payload = {
        "requests": [
            {
                "request_id": "REQ-NORMAL",
                "room_type_id": 1,
                "check_in_date": "2026-11-01",
                "check_out_date": "2026-11-04",
                "guest_count": 2,
                "revenue_value": 3600000,
                "vip_priority": 1,
            },
            {
                "request_id": "REQ-VIP-COMPETING",
                "room_type_id": 1,
                "check_in_date": "2026-11-02",
                "check_out_date": "2026-11-05",
                "guest_count": 2,
                "revenue_value": 5000000,
                "vip_priority": 4,
            },
        ],
        "available_rooms": [
            {
                "room_id": 101,
                "room_number": "101",
                "type_id": 1,
                "capacity": 2,
                "current_status": "Available",
                "housekeeping_status": "Ready",
            }
        ],
        "allow_upgrades": False,
    }
    resp = client.post("/api/v1/revenue/optimize-allocation", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] in ("OPTIMAL", "FEASIBLE")

    assigned = [a for a in data["assignments"] if a["status"] == "ASSIGNED"]
    rejected = [a for a in data["assignments"] if a["status"] == "REJECTED_NO_CAPACITY"]

    # Only 1 physical room exists, so exactly 1 assigned, 1 rejected -> zero oversell
    assert len(assigned) == 1
    assert len(rejected) == 1
    # Higher VIP priority wins
    assert assigned[0]["request_id"] == "REQ-VIP-COMPETING"
    assert rejected[0]["request_id"] == "REQ-NORMAL"
