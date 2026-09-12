"""
Vietnam Tourism Calendar & Seasonality Engine
Provides comprehensive detection of Vietnamese national public holidays,
lunar festive periods (Tết Nguyên Đán, Giỗ Tổ Hùng Vương), and resort tourism seasonality.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Final

# Precomputed Lunar New Year (Tết Nguyên Đán) official holiday intervals (Solar Dates)
LUNAR_NEW_YEAR_PERIODS: Final[dict[int, tuple[date, date]]] = {
    2024: (date(2024, 2, 8), date(2024, 2, 15)),
    2025: (date(2025, 1, 25), date(2025, 2, 3)),
    2026: (date(2026, 2, 14), date(2026, 2, 23)),
    2027: (date(2027, 2, 4), date(2027, 2, 13)),
}

# Hung Kings Memorial Day (10th day of 3rd Lunar Month)
HUNG_KINGS_DAYS: Final[dict[int, date]] = {
    2024: date(2024, 4, 18),
    2025: date(2025, 4, 7),
    2026: date(2026, 4, 26),
    2027: date(2027, 4, 15),
}


def is_vietnam_holiday(check_date: date) -> tuple[bool, str]:
    """
    Detect if a given calendar date falls on an official Vietnamese public holiday
    or major festive period.
    """
    year = check_date.year

    # 1. New Year's Day (Tết Dương Lịch)
    if check_date.month == 1 and check_date.day == 1:
        return True, "Tết Dương Lịch (New Year's Day)"

    # 2. Lunar New Year (Tết Nguyên Đán)
    if year in LUNAR_NEW_YEAR_PERIODS:
        start_tet, end_tet = LUNAR_NEW_YEAR_PERIODS[year]
        if start_tet <= check_date <= end_tet:
            return True, "Tết Nguyên Đán (Lunar New Year Festive Season)"

    # 3. Hung Kings Commemoration Day (Giỗ Tổ Hùng Vương)
    if year in HUNG_KINGS_DAYS:
        hung_day = HUNG_KINGS_DAYS[year]
        if check_date == hung_day:
            return True, "Giỗ Tổ Hùng Vương (Hung Kings Commemoration)"

    # 4. Reunification & International Labor Day (30/4 - 1/5)
    if (check_date.month == 4 and check_date.day == 30) or (check_date.month == 5 and check_date.day in (1, 2)):
        return True, "Đại Lễ 30/4 - 1/5 (Reunification & Labor Day)"

    # 5. National Independence Day (Quốc Khánh 2/9)
    if check_date.month == 9 and check_date.day in (1, 2, 3):
        return True, "Quốc Khánh (Vietnam National Day)"

    # 6. Year-end Festive / Christmas
    if check_date.month == 12 and check_date.day in (24, 25, 31):
        return True, "Mùa Lễ Hội Cuối Năm (Christmas & Year-End Eve)"

    return False, "Normal Day"


def get_vietnam_seasonal_index(check_date: date) -> tuple[float, str]:
    """
    Returns the seasonality index (multiplier offset) for Vietnam luxury coastal resorts.
    - Summer Peak (June - August): Domestic family beach travel peak.
    - Winter Inbound Peak (December - March): International winter-sun luxury travelers.
    - Monsoon / Low Season (October - November): Central coast rain & typhoon season.
    - Shoulder Seasons (April - May, September): Pleasant transitional climate.
    """
    month = check_date.month

    if month in (6, 7):
        return 1.30, "Cao điểm hè biển (Domestic Summer Beach Vacation)"
    elif month == 8:
        return 1.20, "Cuối hè du lịch (Late Summer)"
    elif month in (12, 1, 2):
        return 1.25, "Cao điểm đón khách quốc tế trú đông (International Winter-Sun Peak)"
    elif month == 3:
        return 1.10, "Mùa xuân biển ấm (Spring Warm Season)"
    elif month in (4, 5):
        return 1.15, "Đầu hè & Lễ hội (Early Summer & Festivals)"
    elif month == 9:
        return 1.05, "Mùa thu dịu mát (Early Autumn)"
    else:  # October, November
        return 0.85, "Mùa thấp điểm mưa miền Trung (Autumn Monsoon & MICE Promotion)"


def calculate_vietnam_demand_score(check_in: date, stay_nights: int) -> dict[str, object]:
    """
    Calculates a combined demand intensity score for a stay at a Vietnam luxury resort.
    Combines holiday impact, seasonal baseline, and weekend surges.
    """
    has_holiday = False
    holiday_reasons = []

    for offset in range(stay_nights):
        day = check_in + timedelta(days=offset)
        is_hol, reason = is_vietnam_holiday(day)
        if is_hol:
            has_holiday = True
            if reason not in holiday_reasons:
                holiday_reasons.append(reason)

    season_mult, season_name = get_vietnam_seasonal_index(check_in)

    # Base holiday multiplier
    holiday_mult = 1.35 if has_holiday else 1.0

    return {
        "has_holiday": has_holiday,
        "holiday_names": holiday_reasons,
        "season_name": season_name,
        "season_multiplier": season_mult,
        "holiday_multiplier": holiday_mult,
        "combined_market_factor": round(season_mult * (1.20 if has_holiday else 1.0), 3),
    }
