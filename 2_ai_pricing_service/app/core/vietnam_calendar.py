"""Verified 2026 Vietnam date facts, separate from legacy demo price rules.

Public-sector breaks include weekends/swapped workdays, not universal enterprise
closures. Unknown years and property-specific festivals are not inferred.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Final

CALENDAR_VERSION: Final = "vn-2026-09-15"
VERIFIED_YEARS: Final = frozenset({2026})
TET_SOURCE: Final = "https://en.baochinhphu.vn/prime-minister-approves-9-day-lunar-new-year-holiday-in-2026-111251014090102864.htm"
NEW_YEAR_SOURCE: Final = "https://xaydungchinhsach.chinhphu.vn/lich-nghi-tet-duong-lich-2026-119251225111725138.htm"
SPRING_SOURCE: Final = "https://baochinhphu.vn/bo-noi-vu-khong-co-chu-truong-hoan-doi-de-nghi-9-ngay-dip-gio-to-30-41-5-102260403124126624.htm"
NATIONAL_DAY_SOURCE: Final = "https://xaydungchinhsach.chinhphu.vn/thong-bao-lich-nghi-le-quoc-khanh-2026-119260729092042494.htm"
CULTURE_DAY_SOURCE: Final = "https://en.baochinhphu.vn/november-24-recognized-as-viet-nams-public-holiday-111260424130923489.htm"


@dataclass(frozen=True, slots=True)
class CalendarPeriod:
    name: str
    start: date
    end: date  # Inclusive calendar interval; hotel checkout remains exclusive.
    source_url: str

    def includes(self, day: date) -> bool:
        return self.start <= day <= self.end


# Statutory dates using the public-sector schedule. Enterprise Tet and National
# Day arrangements may differ. The proposed longer November break is excluded.
PUBLIC_HOLIDAYS: Final = (
    CalendarPeriod("Tết Dương lịch", date(2026, 1, 1), date(2026, 1, 1), NEW_YEAR_SOURCE),
    CalendarPeriod("Tết Nguyên Đán", date(2026, 2, 16), date(2026, 2, 20), TET_SOURCE),
    CalendarPeriod("Giỗ Tổ Hùng Vương", date(2026, 4, 26), date(2026, 4, 26), SPRING_SOURCE),
    CalendarPeriod("Ngày Chiến thắng", date(2026, 4, 30), date(2026, 4, 30), SPRING_SOURCE),
    CalendarPeriod("Ngày Quốc tế Lao động", date(2026, 5, 1), date(2026, 5, 1), SPRING_SOURCE),
    CalendarPeriod("Quốc khánh", date(2026, 9, 1), date(2026, 9, 2), NATIONAL_DAY_SOURCE),
    # Resolution 28/2026/QH16 effective 2026-07-01.
    CalendarPeriod("Ngày Văn hóa Việt Nam", date(2026, 11, 24), date(2026, 11, 24), CULTURE_DAY_SOURCE),
)
PUBLIC_SECTOR_BREAKS: Final = (
    CalendarPeriod("Nghỉ Tết Dương lịch", date(2026, 1, 1), date(2026, 1, 4), NEW_YEAR_SOURCE),
    CalendarPeriod("Nghỉ Tết Nguyên Đán", date(2026, 2, 14), date(2026, 2, 22), TET_SOURCE),
    CalendarPeriod("Nghỉ Giỗ Tổ Hùng Vương", date(2026, 4, 25), date(2026, 4, 27), SPRING_SOURCE),
    CalendarPeriod("Nghỉ 30/4 – 1/5", date(2026, 4, 30), date(2026, 5, 3), SPRING_SOURCE),
    CalendarPeriod("Nghỉ Quốc khánh", date(2026, 8, 29), date(2026, 9, 2), NATIONAL_DAY_SOURCE),
)


def _validate_year(day: date) -> None:
    if day.year not in VERIFIED_YEARS:
        raise ValueError(f"Vietnam calendar coverage is unverified for year {day.year}")


def is_vietnam_holiday(check_date: date) -> tuple[bool, str]:
    """Legacy helper: public holiday OR published public-sector holiday break.

    Use build_vietnam_calendar_features to distinguish the two. Christmas,
    May 2 and September 3 are not fixed national public holidays.
    """
    _validate_year(check_date)
    matches = [p.name for p in (*PUBLIC_HOLIDAYS, *PUBLIC_SECTOR_BREAKS) if p.includes(check_date)]
    return bool(matches), "; ".join(matches) if matches else "Normal Day"


def build_vietnam_calendar_features(check_in: date, stay_nights: int) -> dict[str, object]:
    """Date facts only; no invented demand scores or price effects."""
    if not isinstance(stay_nights, int) or isinstance(stay_nights, bool) or stay_nights < 1:
        raise ValueError("stay_nights must be a positive integer")
    holiday_nights = 0
    break_nights = 0
    names: set[str] = set()
    sources: set[str] = set()
    for offset in range(stay_nights):
        day = check_in + timedelta(days=offset)
        _validate_year(day)
        holidays = [p for p in PUBLIC_HOLIDAYS if p.includes(day)]
        breaks = [p for p in PUBLIC_SECTOR_BREAKS if p.includes(day)]
        holiday_nights += bool(holidays)
        break_nights += bool(breaks)
        for period in (*holidays, *breaks):
            names.add(period.name)
            sources.add(period.source_url)
    return {
        "calendar_version": CALENDAR_VERSION,
        "country_code": "VN",
        "calendar_scope": "public_sector_2026",
        "public_holiday_nights": holiday_nights,
        "public_sector_break_nights": break_nights,
        "holiday_share": holiday_nights / stay_nights,
        "holiday_names": sorted(names),
        "source_urls": sorted(sources),
        "regional_events_status": "property_location_unconfigured",
    }


def get_vietnam_seasonal_index(check_date: date) -> tuple[float, str]:
    """Unvalidated coastal-resort demo assumptions, not learned market factors.

    Property province and local observations are unavailable. Only the mock
    generator consumes this legacy helper; live pricing does not use it.
    """
    month = check_date.month
    if month in (6, 7):
        return 1.30, "Demo assumption: summer"
    if month == 8:
        return 1.20, "Demo assumption: late summer"
    if month in (12, 1, 2):
        return 1.25, "Demo assumption: winter inbound travel"
    if month == 3:
        return 1.10, "Demo assumption: spring"
    if month in (4, 5):
        return 1.15, "Demo assumption: early summer"
    if month == 9:
        return 1.05, "Demo assumption: early autumn"
    return 0.85, "Demo assumption: central-coast low season"


def calculate_vietnam_demand_score(check_in: date, stay_nights: int) -> dict[str, object]:
    """Legacy mock-generator rules; never a measured or learned demand target."""
    calendar = build_vietnam_calendar_features(check_in, stay_nights)
    has_holiday = bool(calendar["public_holiday_nights"] or calendar["public_sector_break_nights"])
    season_mult, season_name = get_vietnam_seasonal_index(check_in)
    return {
        **calendar,
        "signal_provenance": "synthetic_demo_heuristic",
        "has_holiday": has_holiday,
        "season_name": season_name,
        "season_multiplier": season_mult,
        "holiday_multiplier": 1.35 if has_holiday else 1.0,
        "combined_market_factor": round(season_mult * (1.20 if has_holiday else 1.0), 3),
    }
