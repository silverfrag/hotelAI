"""Normalize dates supported by literal evidence, never by the clock/publication year."""
import re
from datetime import date

DATE_LEXEMES = r"(?<!\d)(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-/]\d{1,2}(?:[-/]\d{4})?)(?!\d)"


def literal_date(value):
    value = value.strip()
    iso = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", value)
    if iso:
        return date(*map(int, iso.groups()))
    local = re.fullmatch(r"(\d{1,2})[-/](\d{1,2})[-/](\d{4})", value)
    if local:
        day, month, year = map(int, local.groups())
        return date(year, month, day)
    raise ValueError("Date must include an explicit year in the evidence")


def evidence_date_range(start_quote, end_quote, passage, occurrence_year_quote=None):
    if start_quote not in passage or end_quote not in passage:
        raise ValueError("Date evidence is not verbatim")
    try:
        start, end = literal_date(start_quote), literal_date(end_quote)
        rule = "literal_full_dates"
    except ValueError:
        if occurrence_year_quote is not None:
            if (not re.fullmatch(r"(?:19|20)\d{2}", occurrence_year_quote)
                    or not re.search(r"(?<!\d)" + occurrence_year_quote + r"(?!\d)", passage)
                    or re.search(r"ngày đăng|đăng ngày|cập nhật|publication", passage, re.I)):
                raise ValueError("Occurrence year must be copied from this same occurrence passage")
            partial_start = re.fullmatch(r"(\d{1,2})[-/](\d{1,2})", start_quote)
            partial_end = re.fullmatch(r"(\d{1,2})[-/](\d{1,2})", end_quote)
            if not partial_start or not partial_end:
                raise ValueError("Explicit year components require day/month evidence")
            sd, sm = map(int, partial_start.groups())
            ed, em = map(int, partial_end.groups())
            start = date(int(occurrence_year_quote), sm, sd)
            end = date(int(occurrence_year_quote), em, ed)
            if start > end:
                raise ValueError("Ambiguous cross-year occurrence")
            return start, end, "explicit_year_in_occurrence_span"
        # A shared year is permitted only in one explicit grammatical range,
        # e.g. 'từ ngày 30-8 đến ngày 06-9-2026'. No publication/clock inference.
        pattern = r"từ\s+(?:ngày\s+)?" + re.escape(start_quote) + r"\s+(?:đến|tới)\s+(?:hết\s+)?(?:ngày\s+)?" + re.escape(end_quote) + r"(?![-/\d])"
        if not re.search(pattern, passage, re.I):
            raise ValueError("Missing year outside an explicit single range")
        partial = re.fullmatch(r"(\d{1,2})[-/](\d{1,2})", start_quote)
        if not partial:
            raise ValueError("Ambiguous partial date")
        try:
            end = literal_date(end_quote)
        except ValueError:
            ending = re.fullmatch(r"(\d{1,2})[-/](\d{1,2})", end_quote)
            years = set(re.findall(r"\bnăm\s+((?:19|20)\d{2})\b", passage, re.I))
            if not ending or len(years) != 1 or re.search(r"ngày đăng|đăng ngày|cập nhật", passage, re.I):
                raise ValueError("Shared year is not explicitly established in this occurrence passage")
            end_day, end_month = map(int, ending.groups())
            end = date(int(next(iter(years))), end_month, end_day)
        day, month = map(int, partial.groups())
        start = date(end.year, month, day)
        rule = "explicit_shared_year_in_single_range"
    if start > end:
        raise ValueError("Reversed or ambiguous cross-year range")
    return start, end, rule
