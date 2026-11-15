"""Deterministic bilingual (VI/EN) grounded NLP extractor for Da Nang public documents.

Never fabricates dates, locations, prices, or events. Every extracted span (`quote`,
`title`, `location_quote`, `start_date_quote`, `end_date_quote`, `status_quote`)
is guaranteed to be a verbatim substring of its source document and validated via
`evidence_date_range` without clock/publication-year leakage.
"""
from __future__ import annotations

import re
from datetime import date

from app.core.evidence_dates import DATE_LEXEMES, evidence_date_range
from app.schemas.market_pricing_schema import ExtractedEvent

NATIVE_VN_NLP_VERSION = "native_vn_nlp_v1"

_CMS_METADATA_RE = re.compile(
    r"^\s*\d{1,2}/\d{1,2}/\d{4}\s+\d{1,2}:\d{2}\s*,\s*Lượt xem:",
    re.I,
)
_PUB_CONTEXT_RE = re.compile(r"ngày đăng|đăng ngày|cập nhật|publication", re.I)
_DANANG_LOC_RE = re.compile(
    r"(?:TP\.?\s*)?(?:Đà\s*Nẵng|Da\s*Nang|Danang)",
    re.I,
)
_RANGE_RE = re.compile(
    r"(từ\s+(?:ngày\s+)?(\d{1,2}[-/]\d{1,2}(?:[-/]\d{4})?|\d{4}-\d{1,2}-\d{1,2})"
    r"\s+(?:đến|tới)\s+(?:hết\s+)?(?:ngày\s+)?"
    r"(\d{1,2}[-/]\d{1,2}(?:[-/]\d{4})?|\d{4}-\d{1,2}-\d{1,2})(?![-/\d]))",
    re.I,
)
_EN_RANGE_RE = re.compile(
    r"(from\s+(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})"
    r"\s+(?:to|until|through)\s+"
    r"(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})(?![-/\d]))",
    re.I,
)
_DASH_RANGE_RE = re.compile(
    r"(?<!\d)(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})\s*[-–—]\s*"
    r"(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})(?!\d)",
)
_YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")

_OFFER_KW_RE = re.compile(
    r"ưu đãi|khuyến\s*m[ạã]i|giảm\s*giá|gói\s*nghỉ\s*dưỡng|offer|promotion|package|early\s*bird|combo",
    re.I,
)
_DISRUPTION_KW_RE = re.compile(
    r"tạm\s*cấm\s*đường|cấm\s*đường|tạm\s*ngừng|hủy\s*chuyến|hoãn\s*bay|cảnh\s*báo\s*bão|ngập\s*lụt|disruption|road\s*closure",
    re.I,
)
_CANCELLED_KW_RE = re.compile(
    r"thông\s*báo\s*hủy|hủy\s*tổ\s*chức|đã\s*hủy|tạm\s*hoãn|cancelled|postponed",
    re.I,
)
_UPDATED_KW_RE = re.compile(
    r"điều\s*chỉnh\s*lịch|thay\s*đổi\s*thời\s*gian|lịch\s*mới|updated\s*schedule",
    re.I,
)
_EVENT_CONTEXT_RE = re.compile(
    r"sự\s*kiện|lễ\s*hội|diễn\s*ra|khai\s*mạc|pháo\s*hoa|festival|marathon|hội\s*chợ|chương\s*trình|giao\s*thương|triển\s*lãm|offer|package|ưu\s*đãi",
    re.I,
)
_PROMPT_INJECTION_RE = re.compile(
    r"ignore\s+all|earlier\s+rules|malicious\s+instruction|even\s+though\s+there\s+is\s+no|^\s*system\s*:",
    re.I,
)


def _find_line_offsets(text: str) -> list[tuple[int, int, str]]:
    """Return list of (start_idx, end_idx, line_text) preserving exact character offsets."""
    lines: list[tuple[int, int, str]] = []
    pos = 0
    for chunk in text.splitlines(keepends=True):
        stripped = chunk.rstrip("\r\n")
        lines.append((pos, pos + len(stripped), stripped))
        pos += len(chunk)
    return lines


def _extract_date_candidates(quote: str) -> list[tuple[str, str, str | None, date, date, str]]:
    """Return validated (start_q, end_q, year_q, start_d, end_d, rule) candidates from a quote."""
    if _PUB_CONTEXT_RE.search(quote):
        return []

    candidates: list[tuple[str, str, str | None]] = []

    for m in _RANGE_RE.finditer(quote):
        candidates.append((m.group(2), m.group(3), None))
        years = _YEAR_RE.findall(quote)
        if len(set(years)) == 1:
            candidates.append((m.group(2), m.group(3), years[0]))

    for m in _EN_RANGE_RE.finditer(quote):
        candidates.append((m.group(2), m.group(3), None))

    for m in _DASH_RANGE_RE.finditer(quote):
        candidates.append((m.group(1), m.group(2), None))

    # Fallback: adjacent explicit full dates in the same sentence/line
    full_dates = [
        m.group(0)
        for m in re.finditer(DATE_LEXEMES, quote)
        if re.fullmatch(r"\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}", m.group(0))
    ]
    if len(full_dates) >= 2:
        candidates.append((full_dates[0], full_dates[1], None))
    elif len(full_dates) == 1 and _EVENT_CONTEXT_RE.search(quote):
        candidates.append((full_dates[0], full_dates[0], None))

    validated: list[tuple[str, str, str | None, date, date, str]] = []
    seen_spans: set[tuple[str, str, str | None]] = set()
    for start_q, end_q, year_q in candidates:
        key = (start_q, end_q, year_q)
        if key in seen_spans:
            continue
        seen_spans.add(key)
        try:
            start_d, end_d, rule = evidence_date_range(start_q, end_q, quote, year_q)
        except ValueError:
            continue
        # Guard against unreasonable multi-year boilerplate spans (> 366 days)
        if (end_d - start_d).days > 366:
            continue
        validated.append((start_q, end_q, year_q, start_d, end_d, rule))
    return validated


_OTHER_CITY_RE = re.compile(
    r"\b(?:Nha\s*Trang|Hà\s*Nội|Ha\s*Noi|Hồ\s*Chí\s*Minh|Ho\s*Chi\s*Minh|TP\.?\s*HCM|Sài\s*Gòn|Phú\s*Quốc|Phu\s*Quoc|Hội\s*An|Hoi\s*An|Huế|Vũng\s*Tàu|Quy\s*Nhơn|Đà\s*Lạt|Da\s*Lat|Cần\s*Thơ)\b",
    re.I,
)


def _find_verbatim_title(raw_text: str, lines: list[tuple[int, int, str]], idx: int, quote: str) -> str:
    """Pick a concise verbatim heading before idx, else compact quote itself."""
    for lookback in (idx - 1, idx - 2):
        if 0 <= lookback < len(lines):
            candidate = lines[lookback][2].strip()
            if (
                5 <= len(candidate) <= 120
                and not candidate.endswith(".")
                and not _CMS_METADATA_RE.match(candidate)
                and not _PROMPT_INJECTION_RE.search(candidate)
                and not re.search(DATE_LEXEMES, candidate)
                and not re.fullmatch(r"[\d/\-:.\s]+", candidate)
                and candidate in raw_text
            ):
                return candidate
    compact = quote.strip()[:180].strip()
    if compact and compact in raw_text:
        return compact
    return lines[idx][2].strip()[:180]


def _find_location_quote(raw_text: str, lines: list[tuple[int, int, str]], idx: int, quote: str) -> str | None:
    m = _DANANG_LOC_RE.search(quote)
    if m and m.group(0) in raw_text:
        return m.group(0)
    # Reject explicitly non-Da Nang lines that don't mention Da Nang themselves
    if _OTHER_CITY_RE.search(quote):
        return None
    # Check immediate preceding heading(s) (non-dated) or page title lines [0..2]
    search_indices = [i for i in (idx - 1, idx - 2, 0, 1, 2) if 0 <= i < len(lines)]
    for li in search_indices:
        line_text = lines[li][2]
        if li in (idx - 1, idx - 2) and re.search(DATE_LEXEMES, line_text):
            continue
        lm = _DANANG_LOC_RE.search(line_text)
        if lm and lm.group(0) in raw_text and len(lm.group(0)) >= 3:
            return lm.group(0)
    return None


def _classify_fact_type(kind: str, title: str, quote: str) -> str:
    combined = f"{title}\n{quote}"
    if _DISRUPTION_KW_RE.search(combined):
        return "travel_disruption"
    if kind == "hotel_page" or _OFFER_KW_RE.search(combined):
        return "hotel_offer"
    return "event"


def _detect_status(raw_text: str, lines: list[tuple[int, int, str]], idx: int, quote: str) -> tuple[str, str]:
    window_indices = [i for i in range(idx, min(len(lines), idx + 3))]
    for li in window_indices:
        line_text = lines[li][2].strip()
        if not line_text or line_text not in raw_text:
            continue
        if _CANCELLED_KW_RE.search(line_text):
            return "cancelled", line_text[:200]
        if _UPDATED_KW_RE.search(line_text):
            return "updated", line_text[:200]
    if _CANCELLED_KW_RE.search(quote):
        return "cancelled", quote[:200]
    if _UPDATED_KW_RE.search(quote):
        return "updated", quote[:200]
    return "scheduled", ""


def extract_native_danang_facts(documents: list[dict]) -> dict:
    """Extract strictly grounded Da Nang events, travel disruptions, and hotel offers."""
    extracted: list[dict] = []
    seen: set[tuple] = set()

    for doc in documents[:8]:
        source_id = str(doc.get("source_id", "")).strip()
        kind = str(doc.get("kind", "events")).strip()
        raw_text = str(doc.get("text", ""))
        if not source_id or not raw_text:
            continue

        lines = _find_line_offsets(raw_text)
        for idx, (start_off, end_off, line_text) in enumerate(lines):
            stripped = line_text.strip()
            if not stripped or _CMS_METADATA_RE.match(stripped) or _PROMPT_INJECTION_RE.search(stripped):
                continue
            if not re.search(DATE_LEXEMES, stripped):
                continue

            # Ensure quote length >= 15 using exact verbatim slice if a single line is short
            quote = stripped
            if len(quote) < 15 and idx > 0:
                prev_start = lines[idx - 1][0]
                slice_candidate = raw_text[prev_start:end_off].strip()
                if len(slice_candidate) >= 15 and slice_candidate in raw_text:
                    quote = slice_candidate
            if len(quote) < 15 or len(quote) > 1900 or quote not in raw_text:
                continue

            candidates = _extract_date_candidates(quote)
            if not candidates:
                continue

            location_quote = _find_location_quote(raw_text, lines, idx, quote)
            if not location_quote:
                continue

            title = _find_verbatim_title(raw_text, lines, idx, quote)
            if len(title) < 3 or title not in raw_text:
                continue

            fact_type = _classify_fact_type(kind, title, quote)
            event_status, status_quote = _detect_status(raw_text, lines, idx, quote)
            start_q, end_q, year_q, start_d, end_d, rule = candidates[0]

            dedupe_key = (source_id, fact_type, event_status, title.casefold(), start_d.isoformat(), end_d.isoformat())
            if dedupe_key in seen:
                continue

            try:
                payload = ExtractedEvent.model_validate({
                    "fact_type": fact_type,
                    "normalization_rule": rule,
                    "occurrence_year_quote": year_q,
                    "event_status": event_status,
                    "status_quote": status_quote,
                    "title": title,
                    "source_id": source_id,
                    "quote": quote,
                    "location_quote": location_quote,
                    "start_date": start_d.isoformat(),
                    "end_date": end_d.isoformat(),
                    "start_date_quote": start_q,
                    "end_date_quote": end_q,
                }).model_dump(mode="json")
            except Exception:
                continue

            seen.add(dedupe_key)
            extracted.append(payload)
            if len(extracted) >= 12:
                return {"events": extracted}

    return {"events": extracted}
