from datetime import date

import pytest

from app.core.evidence_dates import evidence_date_range, literal_date


@pytest.mark.parametrize("value", ["2026-12-30", "30/12/2026", "30-12-2026"])
def test_explicit_date_formats_are_equivalent(value):
    assert literal_date(value) == date(2026, 12, 30)


def test_shared_year_is_only_resolved_inside_the_explicit_source_range():
    passage = "Giải tại Đà Nẵng từ ngày 30-8 đến ngày 06-9-2026."
    start, end, rule = evidence_date_range("30-8", "06-9-2026", passage)
    assert (start, end) == (date(2026, 8, 30), date(2026, 9, 6))
    assert rule == "explicit_shared_year_in_single_range"


def test_model_may_copy_a_year_present_in_the_same_occurrence_passage():
    quote = 'Ngày 30-7, tổ chức Ngày hội 2026 tại Đà Nẵng.'
    start, end, rule = evidence_date_range('30-7', '30-7', quote, '2026')
    assert start == end == date(2026, 7, 30)
    assert rule == 'explicit_year_in_occurrence_span'
    with pytest.raises(ValueError):
        evidence_date_range('30-7', '30-7', quote, '2025')


def test_partial_range_with_explicit_named_year_is_not_current_clock_year():
    text = 'Từ ngày 28-8 đến hết ngày 2-9, dịp Quốc khánh năm 2026.'
    assert evidence_date_range('28-8', '2-9', text)[:2] == (date(2026, 8, 28), date(2026, 9, 2))


@pytest.mark.parametrize("start,end,quote", [
    ("30-8", "06-9-2026", "Đăng ngày 06-9-2026. Sự kiện: 30-8."),
    ("30-12", "3-1-2027", "Từ ngày 30-12 đến ngày 3-1-2027."),
    ("30-8", "06-9", "Đăng ngày 01/01/2026. Từ ngày 30-8 đến ngày 06-9."),
])
def test_publication_year_missing_year_and_ambiguous_cross_year_are_not_guessed(start, end, quote):
    with pytest.raises(ValueError):
        evidence_date_range(start, end, quote)
