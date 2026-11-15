"""Revenue Decision Engine for HotelAI (P8).

Distinguishes 4 transparent sources of truth:
(A) ML learned from real data (ADR reference / cancellation risk).
(B) Booking / room inventory state observed in simulated system.
(C) Simulated market scenario assumptions (demand, weather, competitor price) labeled SIMULATED ASSUMPTION.
(D) Business rules & financial constraints (coupons, floor price, service cost, commission, taxes).

Guarantees non-negative contribution margin (P_net >= Cost_serve).
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Final

from app.core.vietnam_calendar import build_vietnam_calendar_features


@dataclass(frozen=True, slots=True)
class SimulatedCoupon:
    code: str
    discount_pct: float  # e.g. 0.15 = 15%
    max_discount_vnd: float  # e.g. 500,000 VND
    usage_limit: int = 100
    used_count: int = 0
    active: bool = True
    expiry_date: str | None = "2027-12-31"
    min_room_type_id: int = 1
    description_vi: str | None = None
    provenance: str = "BUSINESS_RULE"


DEFAULT_COUPONS: Final[dict[str, SimulatedCoupon]] = {
    "WHITESAND10": SimulatedCoupon(
        code="WHITESAND10",
        discount_pct=0.10,
        max_discount_vnd=300000.0,
        min_room_type_id=1,
        usage_limit=200,
        used_count=0,
        active=True,
    ),
    "SUMMER15": SimulatedCoupon(
        code="SUMMER15",
        discount_pct=0.15,
        max_discount_vnd=450000.0,
        min_room_type_id=1,
        usage_limit=150,
        used_count=0,
        active=True,
    ),
    "SUITE20": SimulatedCoupon(
        code="SUITE20",
        discount_pct=0.20,
        max_discount_vnd=600000.0,
        min_room_type_id=5,
        usage_limit=100,
        used_count=0,
        active=True,
    ),
    "DIFF2026": SimulatedCoupon(
        code="DIFF2026",
        discount_pct=0.12,
        max_discount_vnd=400000.0,
        min_room_type_id=1,
        usage_limit=120,
        used_count=0,
        active=True,
    ),
    "EXPIRED50": SimulatedCoupon(
        code="EXPIRED50",
        discount_pct=0.50,
        max_discount_vnd=1000000.0,
        min_room_type_id=1,
        usage_limit=50,
        used_count=0,
        active=False,
        expiry_date="2025-12-31",
    ),
}


@dataclass(frozen=True, slots=True)
class MarketScenarioConfig:
    scenario_id: str
    name_vi: str
    demand_level: str  # "low" | "normal" | "high" | "surge"
    weather: str  # "sunny_favorable" | "stormy_unfavorable"
    competitor_rate_position: str  # "lower_undercut" | "par_neutral" | "higher_premium"
    serving_cost_per_night: float = 350000.0  # VND (Housekeeping, laundry, amenities, breakfast variable cost)
    channel_commission_pct: float = 0.0  # 0.0 for direct web, 0.15 for OTA
    tax_rate: float = 0.08  # 8% VAT
    service_charge_rate: float = 0.05  # 5% Service Charge
    min_contribution_margin: float = 50000.0  # Minimum required profit margin above serving cost
    provenance: str = "SIMULATED_ASSUMPTION"


DEFAULT_SCENARIOS: Final[dict[str, MarketScenarioConfig]] = {
    "standard": MarketScenarioConfig(
        scenario_id="standard",
        name_vi="Kịch bản Chuẩn Đà Nẵng (Ngày thường, Nắng nhẹ Mỹ Khê)",
        demand_level="normal",
        weather="sunny_favorable",
        competitor_rate_position="par_neutral",
        serving_cost_per_night=350000.0,
        channel_commission_pct=0.0,
    ),
    "weekend_peak": MarketScenarioConfig(
        scenario_id="weekend_peak",
        name_vi="Cao Điểm Cuối Tuần (Du lịch Biển Mỹ Khê tăng mạnh)",
        demand_level="high",
        weather="sunny_favorable",
        competitor_rate_position="higher_premium",
        serving_cost_per_night=400000.0,
        channel_commission_pct=0.0,
    ),
    "holiday_surge": MarketScenarioConfig(
        scenario_id="holiday_surge",
        name_vi="Lễ Hội Pháo Hoa DIFF & Đại Lễ (Đà Nẵng kín phòng)",
        demand_level="surge",
        weather="sunny_favorable",
        competitor_rate_position="higher_premium",
        serving_cost_per_night=450000.0,
        channel_commission_pct=0.0,
    ),
    "monsoon_low": MarketScenarioConfig(
        scenario_id="monsoon_low",
        name_vi="Mùa Mưa Bão Miền Trung (Nhu cầu thấp, Kích cầu an toàn)",
        demand_level="low",
        weather="stormy_unfavorable",
        competitor_rate_position="lower_undercut",
        serving_cost_per_night=300000.0,
        channel_commission_pct=0.0,
    ),
    "ota_flash_sale": MarketScenarioConfig(
        scenario_id="ota_flash_sale",
        name_vi="Chiến dịch Kênh OTA (Hoa hồng 15%, Cạnh tranh khu Sơn Trà)",
        demand_level="normal",
        weather="sunny_favorable",
        competitor_rate_position="lower_undercut",
        serving_cost_per_night=350000.0,
        channel_commission_pct=0.15,
    ),
}


@dataclass(frozen=True, slots=True)
class PriceFactorAttribution:
    factor_name: str
    source_category: str  # "(A) ML_REAL_DATA" | "(B) SIMULATED_SYSTEM_STATE" | "(C) SIMULATED_ASSUMPTION" | "(D) BUSINESS_RULE"
    impact_pct: float
    impact_vnd: float
    description_vi: str


@dataclass(frozen=True, slots=True)
class RevenueDecisionResult:
    # 1. Price Components
    room_type_id: int
    room_type_name: str
    base_price: float
    ml_reference_price: float
    scenario_recommended_rate: float
    coupon_applied: str | None
    coupon_discount_vnd: float
    guest_payable_nightly_rate: float
    total_nights: int
    guest_total_payable: float

    # 2. Financial & Cost Breakdown
    serving_cost_per_night: float
    taxes_and_service_vnd: float
    net_revenue_per_night: float
    estimated_contribution_margin: float
    is_floor_price_clamped: bool

    # 3. Transparent Lineage & Provenance
    factors: list[PriceFactorAttribution]
    scenario_id: str
    scenario_name_vi: str
    caveats: list[str]


class RevenueDecisionEngine:
    """Calculates contextual dynamic rates and evaluates contribution margins."""

    def __init__(
        self,
        scenarios: dict[str, MarketScenarioConfig] | None = None,
        coupons: dict[str, SimulatedCoupon] | None = None,
    ) -> None:
        self.scenarios = scenarios or dict(DEFAULT_SCENARIOS)
        self.coupons = coupons or dict(DEFAULT_COUPONS)

    def evaluate_quote(
        self,
        *,
        room_type_id: int,
        room_type_name: str,
        base_price: float,
        declared_max_price: float | None = None,
        check_in_date: str,
        check_out_date: str,
        guest_count: int,
        rooms_available: int,
        rooms_total: int,
        ml_multiplier: float = 1.0,  # From existing ML Random Forest model
        scenario_id: str = "standard",
        custom_scenario: MarketScenarioConfig | None = None,
        coupon_code: str | None = None,
        coupon_rule: SimulatedCoupon | None = None,
        coupon_lookup_performed: bool = False,
    ) -> RevenueDecisionResult:
        scenario = custom_scenario or self.scenarios.get(scenario_id, DEFAULT_SCENARIOS["standard"])
        factors: list[PriceFactorAttribution] = []
        caveats: list[str] = []

        d_in = datetime.strptime(check_in_date, "%Y-%m-%d").date()
        d_out = datetime.strptime(check_out_date, "%Y-%m-%d").date()
        nights = max(1, (d_out - d_in).days)

        # ── (A) ML Learned ADR Reference ──────────────────────────────────────
        ml_ref_price = round(base_price * ml_multiplier, -3)
        factors.append(
            PriceFactorAttribution(
                factor_name="ML ADR Benchmark",
                source_category="(A) ML_REAL_DATA",
                impact_pct=round((ml_multiplier - 1.0) * 100, 1),
                impact_vnd=ml_ref_price - base_price,
                description_vi=f"Giá tham chiếu từ mô hình ML học trên tập dữ liệu lịch sử (Hệ số ADR: ×{ml_multiplier:.2f}).",
            )
        )
        caveats.append(
            "CẢNH BÁO DỮ LIỆU: Giá tham chiếu ML được huấn luyện từ dữ liệu Bồ Đào Nha 2015-2017, đóng vai trò mốc so sánh lịch sử, không phải giá tối ưu thực tế tại Việt Nam."
        )

        # ── (B) Observed System State: Real-time Occupancy ─────────────────────
        occupancy_ratio = 1.0 - (rooms_available / max(1, rooms_total))
        occupancy_mult = 1.0
        if occupancy_ratio >= 0.85:
            occupancy_mult = 1.20
            desc = f"White Sand Hotel đang có tỷ lệ lấp đầy cao ({occupancy_ratio*100:.0f}%), chỉ còn {rooms_available} phòng trống."
        elif occupancy_ratio >= 0.60:
            occupancy_mult = 1.08
            desc = f"Tỷ lệ lấp đầy ổn định tại khách sạn ({occupancy_ratio*100:.0f}%)."
        elif occupancy_ratio < 0.30:
            occupancy_mult = 0.95
            desc = f"Tỷ lệ lấp đầy thấp ({occupancy_ratio*100:.0f}%), áp dụng hệ số hỗ trợ kích cầu."
        else:
            desc = f"Tỷ lệ lấp đầy trung bình ({occupancy_ratio*100:.0f}%)."

        occ_vnd = (base_price * occupancy_mult) - base_price
        factors.append(
            PriceFactorAttribution(
                factor_name="Tồn kho & Công suất phòng thực tế",
                source_category="(B) SIMULATED_SYSTEM_STATE",
                impact_pct=round((occupancy_mult - 1.0) * 100, 1),
                impact_vnd=occ_vnd,
                description_vi=desc,
            )
        )

        # 2. Weekend vs Weekday Stay Pattern
        cur_d = d_in
        weekend_nights = 0
        while cur_d < d_out:
            if cur_d.weekday() in (4, 5):  # Friday or Saturday night
                weekend_nights += 1
            cur_d += timedelta(days=1)

        weekend_pct = weekend_nights / max(1, nights)
        weekend_mult = 1.0 + (0.15 * weekend_pct) if weekend_nights > 0 else 0.96
        if weekend_nights > 0:
            w_desc = f"Kỳ lưu trú bao gồm {weekend_nights}/{nights} đêm cuối tuần (Thứ 6, Thứ 7) có nhu cầu cao tại Mỹ Khê."
        else:
            w_desc = "Kỳ lưu trú hoàn toàn là ngày thường (Thứ 2 - Thứ 5), áp dụng ưu đãi kích cầu giữa tuần."

        w_vnd = (base_price * weekend_mult) - base_price
        factors.append(
            PriceFactorAttribution(
                factor_name="Mẫu hình ngày (Cuối tuần vs Ngày thường)",
                source_category="(B) SIMULATED_SYSTEM_STATE",
                impact_pct=round((weekend_mult - 1.0) * 100, 1),
                impact_vnd=w_vnd,
                description_vi=w_desc,
            )
        )

        # 2b. Verified Vietnam 2026 Public Holiday Facts
        holiday_mult = 1.0
        if d_in.year == 2026 and d_out.year == 2026:
            try:
                cal = build_vietnam_calendar_features(d_in, nights)
                holiday_share = float(cal.get("holiday_share", 0.0) or 0.0)
                holiday_names = cal.get("holiday_names") or []
                if holiday_share > 0 and holiday_names:
                    holiday_mult = round(1.0 + (0.12 * holiday_share), 4)
                    factors.append(
                        PriceFactorAttribution(
                            factor_name="Lịch nghỉ lễ quốc gia Việt Nam (2026)",
                            source_category="(D) BUSINESS_RULE",
                            impact_pct=round((holiday_mult - 1.0) * 100, 1),
                            impact_vnd=(base_price * holiday_mult) - base_price,
                            description_vi=f"Kỳ lưu trú trùng dịp lễ ({', '.join(holiday_names)}).",
                        )
                    )
            except ValueError:
                pass

        # 3. Guest Count Factor
        guest_mult = 1.0
        if guest_count > 2:
            extra_guests = guest_count - 2
            guest_mult = 1.0 + (0.10 * extra_guests)
            g_vnd = (base_price * guest_mult) - base_price
            factors.append(
                PriceFactorAttribution(
                    factor_name=f"Quy mô đoàn ({guest_count} khách)",
                    source_category="(B) SIMULATED_SYSTEM_STATE",
                    impact_pct=round((guest_mult - 1.0) * 100, 1),
                    impact_vnd=g_vnd,
                    description_vi=f"Phụ thu thêm {extra_guests} khách so với tiêu chuẩn 2 khách.",
                )
            )

        # ── (C) Simulated Market Scenario Assumptions ─────────────────────────
        # 1. Demand signal
        demand_multipliers = {"low": 0.88, "normal": 1.00, "high": 1.15, "surge": 1.30}
        d_mult = demand_multipliers.get(scenario.demand_level, 1.0)
        factors.append(
            PriceFactorAttribution(
                factor_name=f"Nhu cầu thị trường ({scenario.demand_level.upper()})",
                source_category="(C) SIMULATED_ASSUMPTION",
                impact_pct=round((d_mult - 1.0) * 100, 1),
                impact_vnd=(base_price * d_mult) - base_price,
                description_vi=f"Giả định kịch bản: mức độ quan tâm của du khách tại Đà Nẵng ({scenario.demand_level}).",
            )
        )

        # 2. Weather signal
        w_mult = 0.90 if scenario.weather == "stormy_unfavorable" else 1.00
        if w_mult != 1.0:
            factors.append(
                PriceFactorAttribution(
                    factor_name="Thời tiết bất lợi (Mưa bão miền Trung)",
                    source_category="(C) SIMULATED_ASSUMPTION",
                    impact_pct=-10.0,
                    impact_vnd=(base_price * w_mult) - base_price,
                    description_vi="Giả định kịch bản: chiết khấu kích cầu do điều kiện thời tiết xấu.",
                )
            )

        # 3. Competitor parity
        comp_mult = {
            "lower_undercut": 0.95,
            "par_neutral": 1.00,
            "higher_premium": 1.08,
        }.get(scenario.competitor_rate_position, 1.0)
        factors.append(
            PriceFactorAttribution(
                factor_name=f"Vị thế giá đối thủ ({scenario.competitor_rate_position})",
                source_category="(C) SIMULATED_ASSUMPTION",
                impact_pct=round((comp_mult - 1.0) * 100, 1),
                impact_vnd=(base_price * comp_mult) - base_price,
                description_vi="Giả định kịch bản: tương quan giá bán với các khách sạn 4 sao khu vực Biển Mỹ Khê.",
            )
        )

        # ── Calculate Combined Candidate Scenario Price ───────────────────────
        contextual_product = occupancy_mult * weekend_mult * holiday_mult * guest_mult * d_mult * w_mult * comp_mult
        composite_multiplier = (
            (ml_multiplier * 0.35) + (contextual_product * 0.65)
        )
        scenario_recommended = round(base_price * composite_multiplier, -3)

        # ── (D) Declared Ceiling Clamp (Sở Tài chính TP. Đà Nẵng) ─────────────
        if declared_max_price is not None and scenario_recommended > declared_max_price:
            ceiling_rate = round(declared_max_price, -3)
            factors.append(
                PriceFactorAttribution(
                    factor_name="Trần giá niêm yết TP. Đà Nẵng (Kê khai giá)",
                    source_category="(D) BUSINESS_RULE",
                    impact_pct=round(((ceiling_rate - scenario_recommended) / max(1.0, scenario_recommended)) * 100, 1),
                    impact_vnd=ceiling_rate - scenario_recommended,
                    description_vi=f"Giá đề xuất vượt trần niêm yết công khai ({ceiling_rate:,.0f} VND). Hệ thống tự động giới hạn không vượt giá kê khai.",
                )
            )
            caveats.append(
                f"TUÂN THỦ KÊ KHAI GIÁ ĐÀ NẴNG: Giá trước khuyến mãi được giới hạn không vượt trần niêm yết {ceiling_rate:,.0f} VND."
            )
            scenario_recommended = ceiling_rate

        # ── (D) Business Rules: Coupon Validation ─────────────────────────────
        discount_vnd = 0.0
        applied_coupon_code = None
        if coupon_code:
            clean_code = coupon_code.strip().upper()
            if coupon_rule is not None and coupon_rule.code.strip().upper() == clean_code:
                coupon = coupon_rule
            elif coupon_lookup_performed:
                coupon = None
            else:
                coupon = self.coupons.get(clean_code)

            business_today = (datetime.now(timezone.utc) + timedelta(hours=7)).date().isoformat()
            is_expired = bool(coupon and coupon.expiry_date and coupon.expiry_date < business_today)

            if not coupon:
                caveats.append(f"Mã coupon '{coupon_code}' không tồn tại hoặc đã bị hủy.")
            elif not coupon.active or is_expired:
                exp_label = coupon.expiry_date or "không xác định"
                caveats.append(f"Mã coupon '{clean_code}' đã hết hạn sử dụng hoặc tạm ngừng áp dụng ({exp_label}).")
            elif coupon.used_count >= coupon.usage_limit:
                caveats.append(f"Mã coupon '{clean_code}' đã hết số lượt sử dụng tối đa ({coupon.usage_limit} lượt).")
            elif room_type_id < coupon.min_room_type_id:
                caveats.append(
                    f"Mã coupon '{clean_code}' chỉ áp dụng cho hạng phòng cao cấp hơn (từ loại {coupon.min_room_type_id} trở lên)."
                )
            else:
                applied_coupon_code = clean_code
                candidate_discount = scenario_recommended * coupon.discount_pct
                discount_vnd = round(min(candidate_discount, coupon.max_discount_vnd), -3)
                factors.append(
                    PriceFactorAttribution(
                        factor_name=f"Khuyến mãi Coupon ({clean_code})",
                        source_category="(D) BUSINESS_RULE",
                        impact_pct=-round((discount_vnd / max(1.0, scenario_recommended)) * 100, 1),
                        impact_vnd=-discount_vnd,
                        description_vi=(
                            coupon.description_vi
                            or f"Áp dụng giảm {coupon.discount_pct*100:.0f}% (tối đa {coupon.max_discount_vnd:,.0f} VND)."
                        ),
                    )
                )

        # ── (D) Financial Checks: Floor Price & Contribution Margin ───────────
        raw_guest_price = max(0.0, scenario_recommended - discount_vnd)

        # Tax & Net calculation:
        total_tax_rate = scenario.tax_rate + scenario.service_charge_rate
        net_before_comm = raw_guest_price / (1.0 + total_tax_rate)
        net_after_comm = net_before_comm * (1.0 - scenario.channel_commission_pct)
        contribution_margin = net_after_comm - scenario.serving_cost_per_night

        # Check Floor Constraint:
        is_floor_clamped = False
        final_guest_price = raw_guest_price

        # Minimum acceptable net revenue = serving_cost + min_contribution_margin
        required_net = scenario.serving_cost_per_night + scenario.min_contribution_margin
        min_guest_price_floor = round(
            (required_net / max(0.01, (1.0 - scenario.channel_commission_pct))) * (1.0 + total_tax_rate),
            -3,
        )

        if raw_guest_price < min_guest_price_floor:
            is_floor_clamped = True
            final_guest_price = min_guest_price_floor
            factors.append(
                PriceFactorAttribution(
                    factor_name="Ràng buộc Giá Sàn (Contribution Floor)",
                    source_category="(D) BUSINESS_RULE",
                    impact_pct=round(((final_guest_price - raw_guest_price) / max(1.0, raw_guest_price)) * 100, 1),
                    impact_vnd=final_guest_price - raw_guest_price,
                    description_vi=(
                        f"Giá sau giảm ({raw_guest_price:,.0f} VND) làm biên đóng góp âm hoặc vi phạm chi phí phục vụ "
                        f"({scenario.serving_cost_per_night:,.0f} VND). Hệ thống tự động kích hoạt giá sàn an toàn."
                    ),
                )
            )
            caveats.append(
                f"RÀNG BUỘC KINH DOANH: Đã kích hoạt giá sàn {final_guest_price:,.0f} VND để bảo đảm không bán phòng dưới biến phí phục vụ."
            )
            # Recalculate net and margin after clamp
            net_before_comm = final_guest_price / (1.0 + total_tax_rate)
            net_after_comm = net_before_comm * (1.0 - scenario.channel_commission_pct)
            contribution_margin = net_after_comm - scenario.serving_cost_per_night

        tax_and_service_vnd = final_guest_price - net_before_comm

        return RevenueDecisionResult(
            room_type_id=room_type_id,
            room_type_name=room_type_name,
            base_price=base_price,
            ml_reference_price=ml_ref_price,
            scenario_recommended_rate=scenario_recommended,
            coupon_applied=applied_coupon_code,
            coupon_discount_vnd=discount_vnd,
            guest_payable_nightly_rate=final_guest_price,
            total_nights=nights,
            guest_total_payable=final_guest_price * nights,
            serving_cost_per_night=scenario.serving_cost_per_night,
            taxes_and_service_vnd=round(tax_and_service_vnd, 0),
            net_revenue_per_night=round(net_after_comm, 0),
            estimated_contribution_margin=round(contribution_margin, 0),
            is_floor_price_clamped=is_floor_clamped,
            factors=factors,
            scenario_id=scenario.scenario_id,
            scenario_name_vi=scenario.name_vi,
            caveats=caveats,
        )
