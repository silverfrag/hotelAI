"""Tests for FastAPI Revenue Simulator & Constraint Allocation Endpoints."""
import pytest
from fastapi.testclient import TestClient
from app.academic_main import app

client = TestClient(app)


def test_get_scenarios_and_coupons():
    resp = client.get("/api/v1/revenue/scenarios")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert len(data["scenarios"]) >= 4
    assert len(data["coupons"]) >= 3
    # Check scenario labels
    scenario_ids = [s["scenario_id"] for s in data["scenarios"]]
    assert "standard" in scenario_ids
    assert "holiday_surge" in scenario_ids
    assert "monsoon_low" in scenario_ids
    # Check coupon codes
    coupon_codes = [c["code"] for c in data["coupons"]]
    assert "WHITESAND10" in coupon_codes


def test_revenue_decision_api_standard():
    payload = {
        "room_type_id": 1,
        "room_type_name": "Superior Room",
        "base_price": 1200000.0,
        "declared_max_price": 1550000.0,
        "check_in_date": "2026-11-01",
        "check_out_date": "2026-11-03",
        "guest_count": 2,
        "rooms_available": 6,
        "rooms_total": 12,
        "ml_multiplier": 1.10,
        "scenario_id": "standard",
    }
    resp = client.post("/api/v1/revenue/decision", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["room_type_id"] == 1
    assert data["total_nights"] == 2
    assert data["guest_payable_nightly_rate"] > 0
    assert data["scenario_recommended_rate"] <= 1550000.0
    assert len(data["factors"]) >= 3
    assert data["estimated_contribution_margin"] > 0
    assert any("CẢNH BÁO DỮ LIỆU" in c for c in data["caveats"])


def test_revenue_decision_api_with_coupon_and_floor():
    payload = {
        "room_type_id": 1,
        "room_type_name": "Superior Room",
        "base_price": 1200000.0,
        "declared_max_price": 1550000.0,
        "check_in_date": "2026-11-01",
        "check_out_date": "2026-11-02",
        "guest_count": 2,
        "rooms_available": 3,
        "rooms_total": 12,
        "ml_multiplier": 1.0,
        "scenario_id": "holiday_surge",
        "coupon_code": "WHITESAND10",
    }
    resp = client.post("/api/v1/revenue/decision", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["coupon_applied"] == "WHITESAND10"
    assert data["coupon_discount_vnd"] > 0
    assert data["scenario_recommended_rate"] <= 1550000.0


def test_optimize_allocation_api_competing_requests():
    payload = {
        "requests": [
            {
                "request_id": "REQ-1",
                "room_type_id": 1,
                "check_in_date": "2026-11-01",
                "check_out_date": "2026-11-03",
                "guest_count": 2,
                "revenue_value": 2400000,
                "vip_priority": 1,
            },
            {
                "request_id": "REQ-2",
                "room_type_id": 1,
                "check_in_date": "2026-11-02",
                "check_out_date": "2026-11-04",
                "guest_count": 2,
                "revenue_value": 3600000,
                "vip_priority": 2,
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
    # Only 1 physical room existed, so exactly 1 can be assigned
    assert len(assigned) == 1
    assert len(rejected) == 1
    assert assigned[0]["request_id"] == "REQ-2"  # Higher revenue & priority


def test_revenue_decision_accepts_db_coupon_rule():
    payload = {
        "room_type_id": 6,
        "room_type_name": "Studio Apartment",
        "base_price": 2000000.0,
        "declared_max_price": 2300000.0,
        "check_in_date": "2026-11-20",
        "check_out_date": "2026-11-22",
        "guest_count": 2,
        "rooms_available": 4,
        "rooms_total": 6,
        "ml_multiplier": 1.05,
        "scenario_id": "standard",
        "coupon_code": "ADMINNEW18",
        "coupon_lookup_performed": True,
        "coupon_rule": {
            "code": "ADMINNEW18",
            "discount_pct": 0.18,
            "max_discount_vnd": 400000.0,
            "min_room_type_id": 5,
            "description_vi": "Coupon DB mới tạo bởi Admin",
            "usage_limit": 50,
            "used_count": 0,
            "active": True,
            "expiry_date": "2027-12-31",
        },
    }
    resp = client.post("/api/v1/revenue/decision", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["coupon_applied"] == "ADMINNEW18"
    assert data["coupon_discount_vnd"] > 0
