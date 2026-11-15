"""Standalone CLI Runner for the Two AI Hourly Dynamic Pricing Scenarios.

Run:
    python scripts/verify_hourly_scenarios.py

Prints a formatted report of Scenario A (Peak Evening Surge) and Scenario B (Flash Clearance).
"""
from __future__ import annotations

import sys
from pathlib import Path
from datetime import datetime, timezone

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Add parent directory to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.hourly_pricing import (
    RealtimeInventoryState,
    RealtimeTrafficState,
    compute_hourly_dynamic_pricing,
)


def run_scenario_a():
    print("=" * 75)
    print("⚡ KỊCH BẢN A: BÙNG NỔ KHÁCH TỐI THỨ SÁU (SURGE PRICING)")
    print("  Thời điểm: 19:30 tối (Giờ vàng đặt phòng)")
    print("  Lưu lượng: 12 yêu cầu/giờ (Gấp 3.0x mức nền bình thường)")
    print("  Tồn kho:   Chỉ còn 1 phòng Deluxe Suite duy nhất, phòng Standard đã hết 100%")
    print("=" * 75)

    booking_time = datetime(2026, 10, 6, 19, 30, 0, tzinfo=timezone.utc)
    base_price = 1_500_000.0
    baseline_multiplier = 1.10

    inventory = RealtimeInventoryState(
        rooms_available=1,
        rooms_sellable=10,
        hotel_total_available=2,
        hotel_total_sellable=30,
        cheaper_tier_exhausted=True,
    )
    traffic = RealtimeTrafficState(velocity_1h=12, velocity_3h=28, baseline_hourly_velocity=2.0)

    res = compute_hourly_dynamic_pricing(
        base_price=base_price,
        baseline_multiplier=baseline_multiplier,
        check_in_date="2026-10-06",
        booking_time=booking_time,
        inventory=inventory,
        traffic=traffic,
    )

    print(f"  • Giá niêm yết cơ sở:     {base_price:,.0f} VND")
    print(f"  • Hệ số giá nền (Baseline): {baseline_multiplier:.2f}x  --> {base_price * baseline_multiplier:,.0f} VND")
    print(f"  • Hệ số AI thời gian thực:  {res.hourly_multiplier:.2f}x  --> {res.final_nightly_price:,.0f} VND")
    print(f"  • Chênh lệch giá theo giờ:  +{res.final_nightly_price - (base_price * baseline_multiplier):,.0f} VND (+{(res.hourly_multiplier - baseline_multiplier) * 100:.1f}%)")
    print("\n  [BÓC TÁCH YẾU TỐ TOÁN HỌC (ATTRIBUTIONS)]:")
    for b in res.breakdowns:
        sign = "+" if b.impact_pct > 0 else ""
        print(f"    - {b.label_vi:<40}: {sign}{b.impact_pct:.1f}% ({sign}{b.impact_vnd:,.0f} VND)")
        print(f"      * Chi tiết: {b.description}")

    print(f"\n  [KẾT LUẬN MINH BẠCH AI]:\n    \"{res.summary_explanation}\"")
    print(f"  [KỊCH BẢN PHẢN THỰC THẾ]:\n    \"{res.counterfactual_scenario}\"")

    # Assertions
    assert res.hourly_multiplier >= 1.45, f"Expected multiplier >= 1.45x, got {res.hourly_multiplier}"
    assert res.final_nightly_price >= 2_200_000.0
    print("\n  --> [KẾT QUẢ KỊCH BẢN A: PASS THÀNH CÔNG]\n")


def run_scenario_b():
    print("=" * 75)
    print("⚡ KỊCH BẢN B: CỨU VÃN PHÒNG TỒN CHIỀU MUỘN (FLASH CLEARANCE)")
    print("  Thời điểm: 14:30 chiều (Cận giờ nhận phòng 14:00)")
    print("  Lưu lượng: 0 yêu cầu trong 1h qua (Thị trường tạm lắng)")
    print("  Tồn kho:   Còn thừa 6 phòng trống (Nguy cơ hư hao về 0đ sau nửa đêm)")
    print("=" * 75)

    booking_time = datetime(2026, 10, 6, 14, 30, 0, tzinfo=timezone.utc)
    base_price = 1_500_000.0
    baseline_multiplier = 1.00

    inventory = RealtimeInventoryState(
        rooms_available=6,
        rooms_sellable=10,
        hotel_total_available=18,
        hotel_total_sellable=30,
        cheaper_tier_exhausted=False,
    )
    traffic = RealtimeTrafficState(velocity_1h=0, velocity_3h=1, baseline_hourly_velocity=2.0)

    res = compute_hourly_dynamic_pricing(
        base_price=base_price,
        baseline_multiplier=baseline_multiplier,
        check_in_date="2026-10-06",
        booking_time=booking_time,
        inventory=inventory,
        traffic=traffic,
    )

    print(f"  • Giá niêm yết cơ sở:     {base_price:,.0f} VND")
    print(f"  • Hệ số giá nền (Baseline): {baseline_multiplier:.2f}x  --> {base_price * baseline_multiplier:,.0f} VND")
    print(f"  • Hệ số AI thời gian thực:  {res.hourly_multiplier:.2f}x  --> {res.final_nightly_price:,.0f} VND")
    print(f"  • Chênh lệch giá theo giờ:  {res.final_nightly_price - (base_price * baseline_multiplier):,.0f} VND ({(res.hourly_multiplier - baseline_multiplier) * 100:.1f}%)")
    print("\n  [BÓC TÁCH YẾU TỐ TOÁN HỌC (ATTRIBUTIONS)]:")
    for b in res.breakdowns:
        sign = "+" if b.impact_pct > 0 else ""
        print(f"    - {b.label_vi:<40}: {sign}{b.impact_pct:.1f}% ({sign}{b.impact_vnd:,.0f} VND)")
        print(f"      * Chi tiết: {b.description}")

    print(f"\n  [KẾT LUẬN MINH BẠCH AI]:\n    \"{res.summary_explanation}\"")
    print(f"  [KỊCH BẢN PHẢN THỰC THẾ]:\n    \"{res.counterfactual_scenario}\"")

    # Assertions
    assert res.hourly_multiplier <= 0.85, f"Expected multiplier <= 0.85x, got {res.hourly_multiplier}"
    assert res.final_nightly_price <= 1_280_000.0
    print("\n  --> [KẾT QUẢ KỊCH BẢN B: PASS THÀNH CÔNG]\n")


if __name__ == "__main__":
    print("\n" + "#" * 75)
    print("# KIỂM THỬ TỰ ĐỘNG: 2 KỊCH BẢN ĐỊNH GIÁ ĐỘNG THEO GIỜ THỜI GIAN THỰC")
    print("#" * 75 + "\n")
    try:
        run_scenario_a()
        run_scenario_b()
        print("#" * 75)
        print("# TỔNG KẾT: CẢ 2 BÀI KIỂM THỬ ĐỀU ĐẠT CHUẨN HOÀN TOÀN (100% PASS)")
        print("#" * 75 + "\n")
        sys.exit(0)
    except AssertionError as err:
        print(f"\n❌ KIỂM THỬ THẤT BẠI: {err}")
        sys.exit(1)
