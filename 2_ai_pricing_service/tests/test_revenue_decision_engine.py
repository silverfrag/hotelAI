"""Unit tests for Revenue Decision Engine."""
import pytest
from app.services.revenue_decision_engine import (
    DEFAULT_COUPONS,
    DEFAULT_SCENARIOS,
    MarketScenarioConfig,
    RevenueDecisionEngine,
    SimulatedCoupon,
)


def test_standard_quote_evaluation():
    engine = RevenueDecisionEngine()
    result = engine.evaluate_quote(
        room_type_id=1,
        room_type_name="Deluxe King",
        base_price=1200000.0,
        check_in_date="2026-11-01",
        check_out_date="2026-11-03",
        guest_count=2,
        rooms_available=15,
        rooms_total=24,
        ml_multiplier=1.05,
        scenario_id="standard",
    )
    assert result.total_nights == 2
    assert result.guest_payable_nightly_rate > 0
    assert result.estimated_contribution_margin > 0
    assert len(result.factors) >= 3

    # Check 4 source categories present in factors
    sources = {f.source_category for f in result.factors}
    assert "(A) ML_REAL_DATA" in sources
    assert "(B) SIMULATED_SYSTEM_STATE" in sources
    assert "(C) SIMULATED_ASSUMPTION" in sources


def test_valid_coupon_discount():
    engine = RevenueDecisionEngine()
    result = engine.evaluate_quote(
        room_type_id=1,
        room_type_name="Superior Room",
        base_price=1200000.0,
        declared_max_price=1550000.0,
        check_in_date="2026-11-01",
        check_out_date="2026-11-02",
        guest_count=2,
        rooms_available=6,
        rooms_total=12,
        coupon_code="WHITESAND10",
    )
    assert result.coupon_applied == "WHITESAND10"
    assert result.coupon_discount_vnd > 0
    assert result.guest_payable_nightly_rate < result.scenario_recommended_rate
    assert result.scenario_recommended_rate <= 1550000.0


def test_declared_max_price_ceiling_clamp():
    engine = RevenueDecisionEngine()
    result = engine.evaluate_quote(
        room_type_id=1,
        room_type_name="Superior Room",
        base_price=1200000.0,
        declared_max_price=1550000.0,
        check_in_date="2026-09-02",
        check_out_date="2026-09-04",
        guest_count=4,
        rooms_available=1,
        rooms_total=12,
        ml_multiplier=1.35,
        scenario_id="holiday_surge",
    )
    assert result.scenario_recommended_rate <= 1550000.0
    assert any("KÊ KHAI GIÁ ĐÀ NẴNG" in c for c in result.caveats)


def test_expired_or_invalid_coupon():
    engine = RevenueDecisionEngine()
    # Invalid coupon
    res_inv = engine.evaluate_quote(
        room_type_id=1,
        room_type_name="Deluxe King",
        base_price=1200000.0,
        check_in_date="2026-11-01",
        check_out_date="2026-11-02",
        guest_count=2,
        rooms_available=10,
        rooms_total=20,
        coupon_code="INVALID_CODE_999",
    )
    assert res_inv.coupon_applied is None
    assert any("không tồn tại" in c for c in res_inv.caveats)

    # Expired coupon
    res_exp = engine.evaluate_quote(
        room_type_id=1,
        room_type_name="Deluxe King",
        base_price=1200000.0,
        check_in_date="2026-11-01",
        check_out_date="2026-11-02",
        guest_count=2,
        rooms_available=10,
        rooms_total=20,
        coupon_code="EXPIRED50",
    )
    assert res_exp.coupon_applied is None
    assert any("hết hạn" in c for c in res_exp.caveats)


def test_floor_price_and_contribution_margin_safeguard():
    """Extreme discount or tiny base price must not produce negative contribution margin."""
    custom_coupons = {
        "DUMP90": SimulatedCoupon(
            code="DUMP90",
            discount_pct=0.90,  # 90% discount!
            max_discount_vnd=10000000.0,
            usage_limit=10,
            used_count=0,
            active=True,
        )
    }
    engine = RevenueDecisionEngine(coupons=custom_coupons)
    result = engine.evaluate_quote(
        room_type_id=1,
        room_type_name="Budget Room",
        base_price=500000.0,
        check_in_date="2026-11-01",
        check_out_date="2026-11-02",
        guest_count=1,
        rooms_available=10,
        rooms_total=20,
        coupon_code="DUMP90",
        scenario_id="standard",  # serving cost = 350,000 VND
    )

    # Without floor price, 90% off 500k = 50k, which is way below serving cost of 350k!
    # System MUST clamp to floor price to prevent selling at negative margin.
    assert result.is_floor_price_clamped is True
    assert result.estimated_contribution_margin >= 0
    assert any("RÀNG BUỘC KINH DOANH" in c for c in result.caveats)


def test_dynamic_db_coupon_rule_and_room_tier_restriction():
    engine = RevenueDecisionEngine()
    db_coupon = SimulatedCoupon(
        code="CUSTOM25",
        discount_pct=0.25,
        max_discount_vnd=500000.0,
        min_room_type_id=5,
        description_vi="Ưu đãi riêng hạng Suite+",
        usage_limit=20,
        used_count=0,
        active=True,
        expiry_date="2027-12-31",
    )

    rejected = engine.evaluate_quote(
        room_type_id=1,
        room_type_name="Superior Room",
        base_price=1200000.0,
        check_in_date="2026-11-15",
        check_out_date="2026-11-17",
        guest_count=2,
        rooms_available=6,
        rooms_total=12,
        coupon_code="CUSTOM25",
        coupon_rule=db_coupon,
        coupon_lookup_performed=True,
    )
    assert rejected.coupon_applied is None
    assert any("hạng phòng" in c for c in rejected.caveats)

    accepted = engine.evaluate_quote(
        room_type_id=5,
        room_type_name="Suite",
        base_price=1800000.0,
        check_in_date="2026-11-15",
        check_out_date="2026-11-17",
        guest_count=2,
        rooms_available=4,
        rooms_total=8,
        coupon_code="CUSTOM25",
        coupon_rule=db_coupon,
        coupon_lookup_performed=True,
    )
    assert accepted.coupon_applied == "CUSTOM25"
    assert accepted.coupon_discount_vnd > 0

    missing_in_db = engine.evaluate_quote(
        room_type_id=1,
        room_type_name="Superior Room",
        base_price=1200000.0,
        check_in_date="2026-11-15",
        check_out_date="2026-11-17",
        guest_count=2,
        rooms_available=6,
        rooms_total=12,
        coupon_code="WHITESAND10",
        coupon_rule=None,
        coupon_lookup_performed=True,
    )
    assert missing_in_db.coupon_applied is None
    assert any("không tồn tại" in c for c in missing_in_db.caveats)
