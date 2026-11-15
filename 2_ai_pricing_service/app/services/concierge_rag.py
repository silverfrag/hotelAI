"""Hybrid BM25 + TF-IDF Bilingual RAG & Slot Extractor for White Sand Assistant (E5).

Zero external LLM dependencies:
  - Okapi BM25 over unaccented + tokenized VI/EN query/documents
  - scikit-learn TF-IDF (word + character n-grams 3..5) cosine similarity
  - Bilingual slot extraction for check-in/out dates, nights, guest count,
    White Sand room categories, and promo codes (read-only assistance only).
"""
from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


def _strip_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text.lower())
    cleaned = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return cleaned.replace("đ", "d")


def _tokenize(text: str) -> list[str]:
    norm = _strip_accents(text)
    return re.findall(r"[a-z0-9]+", norm)


@dataclass(frozen=True)
class SopDocument:
    doc_id: str
    category: str
    title_vi: str
    title_en: str
    body_vi: str
    body_en: str
    keywords: tuple[str, ...]
    suggested_route: str | None = None

    def searchable_text(self) -> str:
        return " ".join(
            [
                self.doc_id,
                self.category,
                self.title_vi,
                self.title_en,
                self.body_vi,
                self.body_en,
                *self.keywords,
            ]
        )


WHITESAND_KB: tuple[SopDocument, ...] = (
    SopDocument(
        doc_id="WS-LOC-01",
        category="location_contact",
        title_vi="Vị Trí & Liên Hệ White Sand Boutique Hotel",
        title_en="White Sand Location & Concierge Contact",
        body_vi=(
            "Địa chỉ: 89-91 Võ Văn Kiệt, phường An Hải (Phước Mỹ cũ), quận Sơn Trà, TP. Đà Nẵng. "
            "Cách bãi biển Mỹ Khê khoảng 50m (đối diện công viên Biển Đông), cách cầu Rồng 1,5 km, "
            "cách Sân bay Quốc tế Đà Nẵng khoảng 15 phút di chuyển. Hotline: +84 2363 575 799 / +84 766 535 355 · "
            "Email: sm@whitesandhotel.com.vn."
        ),
        body_en=(
            "Address: 89-91 Vo Van Kiet St., An Hai Ward, Son Tra District, Da Nang City. "
            "Highlights: ~50m from My Khe Beach, ~1.5 km from Dragon Bridge, ~15 minutes from Da Nang International Airport. "
            "Hotline: +84 2363 575 799 / +84 766 535 355 · Email: sm@whitesandhotel.com.vn."
        ),
        keywords=("dia chi", "vi tri", "vo van kiet", "my khe", "cau rong", "san bay", "airport", "location", "address", "hotline", "email", "danang"),
        suggested_route="/about",
    ),
    SopDocument(
        doc_id="WS-DIN-02",
        category="dining_restaurant",
        title_vi="Nhà Hàng Biển White Sand (Tầng 14)",
        title_en="White Sand Sea-View Restaurant (14th Floor)",
        body_vi=(
            "Nhà hàng tọa lạc tại Tầng 14 với tầm nhìn hướng biển Mỹ Khê và bán đảo Sơn Trà. "
            "Phục vụ Buffet sáng hàng ngày với ẩm thực đặc sản Đà Nẵng và món Âu. "
            "Yêu cầu đặt bàn hoặc thực đơn ăn kiêng vui lòng liên hệ Lễ tân (+84 2363 575 799)."
        ),
        body_en=(
            "Located on the 14th Floor overlooking My Khe Beach and Son Tra Peninsula. "
            "Daily breakfast buffet features Da Nang specialties and international cuisine. "
            "For table reservations or dietary preferences, contact Reception (+84 2363 575 799)."
        ),
        keywords=("an sang", "buffet", "nha hang", "am thuc", "tang 14", "breakfast", "dining", "restaurant", "menu"),
        suggested_route="/about",
    ),
    SopDocument(
        doc_id="WS-WEL-03",
        category="wellness_facilities",
        title_vi="White Sand Spa (15F), Hồ Bơi & Gym (2F), Wi-Fi",
        title_en="White Sand Spa (15th Floor), Indoor Pool & Gym (2nd Floor), Wi-Fi",
        body_vi=(
            "White Sand Spa (Tầng 15): khách lưu trú trực tiếp được giảm 30% gói massage & trị liệu. "
            "Hồ bơi trong nhà & Phòng Gym (Tầng 2): miễn phí hàng ngày cho khách đang lưu trú. "
            "Wi-Fi tốc độ cao miễn phí toàn bộ khách sạn. Trợ lý chat không trực tiếp tạo lịch hẹn spa."
        ),
        body_en=(
            "White Sand Spa (15th Floor): resident guests enjoy 30% off massage and wellness packages. "
            "Indoor Pool & Fitness Gym (2nd Floor): complimentary daily access for staying guests. "
            "High-speed Wi-Fi included throughout rooms and lobby; live spa booking is handled by Front Desk."
        ),
        keywords=("spa", "massage", "gym", "fitness", "ho boi", "be boi", "pool", "wifi", "tang 2", "tang 15", "wellness", "tien ich"),
        suggested_route="/rooms",
    ),
    SopDocument(
        doc_id="WS-PET-04",
        category="pet_policy",
        title_vi="Chính Sách Thú Cưng",
        title_en="Pet Policy",
        body_vi="Để đảm bảo vệ sinh và không gian yên tĩnh cho tòa nhà 15 tầng, khách sạn hiện không nhận thú cưng (no pets allowed).",
        body_en="To maintain hygiene and quiet comfort across all 15 floors, White Sand Boutique Hotel does not allow pets.",
        keywords=("thu cung", "cho", "meo", "pet", "pets", "dong vat", "pet friendly"),
        suggested_route=None,
    ),
    SopDocument(
        doc_id="WS-CXL-05",
        category="cancellation_policy",
        title_vi="Chính Sách Hủy Phòng & Hoàn Tiền (/bookings)",
        title_en="Cancellation & Refund Lookup (/bookings)",
        body_vi=(
            "Quý khách kiểm tra điều kiện hủy (can_cancel) và hủy đơn trực tuyến tại Lịch sử đặt phòng (/bookings) "
            "cho các booking còn trong thời hạn hợp lệ trước ngày nhận phòng. "
            "Hỗ trợ đổi lịch hoặc hoàn tiền đặc biệt vui lòng liên hệ Lễ tân +84 2363 575 799."
        ),
        body_en=(
            "Guests can verify cancellation eligibility (can_cancel) and cancel online under My Bookings (/bookings) "
            "before the check-in cut-off. For refund assistance or schedule changes, contact Front Desk +84 2363 575 799."
        ),
        keywords=("huy phong", "hoan tien", "doi ngay", "cancel", "cancellation", "refund", "bookings"),
        suggested_route="/bookings",
    ),
    SopDocument(
        doc_id="WS-MEM-06",
        category="loyalty_upgrades",
        title_vi="Hội Viên Loyalty & Nguyên Tắc Nâng Hạng",
        title_en="Loyalty Tiers & Upgrade Rules",
        body_vi=(
            "Bốn hạng hội viên: Bronze (0–999 điểm), Silver (1.000+ điểm), Gold (5.000+ điểm), Platinum (20.000+ điểm). "
            "Nâng hạng phòng thực tế chỉ do nhân viên Lễ tân xác nhận dựa trên tồn kho vật lý và tối ưu không trùng lịch OR-Tools; "
            "trợ lý chat không tự cam kết nâng hạng."
        ),
        body_en=(
            "Four loyalty tiers: Bronze (0–999 pts), Silver (1,000+ pts), Gold (5,000+ pts), Platinum (20,000+ pts). "
            "Actual room upgrades are granted only by Front Desk staff based on live availability; chat assistant never commits upgrades."
        ),
        keywords=("hoi vien", "loyalty", "diem", "nang hang", "upgrade", "platinum", "gold", "silver", "bronze"),
        suggested_route="/profile",
    ),
    SopDocument(
        doc_id="WS-CLK-07",
        category="checkin_checkout",
        title_vi="Giờ Nhận & Trả Phòng Chuẩn",
        title_en="Standard Check-In & Check-Out Hours",
        body_vi=(
            "Giờ nhận phòng (Check-in) từ 14:00; giờ trả phòng (Check-out) trước 12:00 trưa. "
            "Nhận phòng sớm hoặc trả phòng muộn phụ thuộc tình trạng dọn phòng thực tế tại Lễ tân."
        ),
        body_en=(
            "Standard Check-in from 14:00; Check-out before 12:00 noon. "
            "Early check-in or late check-out is subject to live housekeeping readiness at Reception."
        ),
        keywords=("nhan phong", "tra phong", "check in", "check out", "checkin", "checkout", "14:00", "12:00", "gio"),
        suggested_route="/book",
    ),
    SopDocument(
        doc_id="WS-PRV-08",
        category="pricing_coupons",
        title_vi="Bảng Giá Động, Sàn Biến Phí & Mã Ưu Đãi (/book)",
        title_en="Dynamic Quotes, Contribution Floor & Coupons (/book)",
        body_vi=(
            "White Sand có 6 hạng phòng (54 phòng vật lý): Superior Room, Deluxe Room, Premium Room, Executive Room, Suite, Studio Apartment. "
            "Báo giá chốt có thời hạn và kiểm tra mã ưu đãi (WHITESAND10, SUMMER15, DIFF2026, SUITE20) kèm sàn biến phí phục vụ 452.000 VND/đêm tại /book."
        ),
        body_en=(
            "White Sand offers 6 room categories (54 rooms): Superior Room, Deluxe Room, Premium Room, Executive Room, Suite, Studio Apartment. "
            "Locked time-limited quotes with promo codes (WHITESAND10, SUMMER15, DIFF2026, SUITE20) and our VND 452,000/night floor are generated at /book."
        ),
        keywords=("gia phong", "dat phong", "coupon", "voucher", "khuyen mai", "whitesand10", "summer15", "diff2026", "suite20", "superior", "deluxe", "premium", "executive", "suite", "studio", "book", "room", "price"),
        suggested_route="/book",
    ),
)

ROOM_NAME_ALIASES: tuple[tuple[int, str, re.Pattern[str]], ...] = (
    (6, "Studio Apartment", re.compile(r"\bstudio(\s+apartment)?\b|\bcan\s*ho\b")),
    (5, "Suite", re.compile(r"\bsuite\b")),
    (4, "Executive Room", re.compile(r"\bexecutive\b")),
    (3, "Premium Room", re.compile(r"\bpremium\b")),
    (2, "Deluxe Room", re.compile(r"\bdeluxe\b")),
    (1, "Superior Room", re.compile(r"\bsuperior\b|\btieu chuan\b")),
)


class HybridConciergeRagService:
    """In-memory deterministic Hybrid BM25 + TF-IDF retriever & slot parser."""

    def __init__(self, docs: tuple[SopDocument, ...] = WHITESAND_KB) -> None:
        self._docs = list(docs)
        self._tokenized_docs = [_tokenize(doc.searchable_text()) for doc in self._docs]
        self._n_docs = len(self._docs)
        self._avgdl = (
            sum(len(toks) for toks in self._tokenized_docs) / self._n_docs
            if self._n_docs
            else 1.0
        )
        # Document frequency map for BM25
        self._df: dict[str, int] = {}
        for toks in self._tokenized_docs:
            for term in set(toks):
                self._df[term] = self._df.get(term, 0) + 1

        # Character + Word TF-IDF index over unaccented text
        corpus = [_strip_accents(doc.searchable_text()) for doc in self._docs]
        self._word_vec = TfidfVectorizer(ngram_range=(1, 2), lowercase=True)
        self._char_vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), lowercase=True)
        self._word_mat = self._word_vec.fit_transform(corpus)
        self._char_mat = self._char_vec.fit_transform(corpus)

    def _bm25_scores(self, query_tokens: list[str], k1: float = 1.5, b: float = 0.75) -> list[float]:
        scores: list[float] = []
        for toks in self._tokenized_docs:
            dl = len(toks)
            tf_map: dict[str, int] = {}
            for t in toks:
                tf_map[t] = tf_map.get(t, 0) + 1
            total = 0.0
            for q in query_tokens:
                df = self._df.get(q, 0)
                if df == 0:
                    continue
                idf = math.log(1.0 + (self._n_docs - df + 0.5) / (df + 0.5))
                tf = tf_map.get(q, 0)
                if tf == 0:
                    continue
                denom = tf + k1 * (1.0 - b + b * (dl / self._avgdl))
                total += idf * (tf * (k1 + 1.0) / denom)
            scores.append(total)
        return scores

    def retrieve(self, query: str, top_k: int = 3, language: str = "vi") -> list[dict[str, Any]]:
        norm_q = _strip_accents(query)
        q_tokens = _tokenize(query)
        bm25_raw = self._bm25_scores(q_tokens)
        bm25_max = max(bm25_raw) if bm25_raw else 0.0

        w_sim = cosine_similarity(self._word_vec.transform([norm_q]), self._word_mat)[0]
        c_sim = cosine_similarity(self._char_vec.transform([norm_q]), self._char_mat)[0]

        ranked: list[tuple[float, dict[str, Any]]] = []
        for idx, doc in enumerate(self._docs):
            bm25_norm = (bm25_raw[idx] / bm25_max) if bm25_max > 0 else 0.0
            tfidf_score = 0.55 * float(w_sim[idx]) + 0.45 * float(c_sim[idx])
            fused = 0.50 * bm25_norm + 0.50 * tfidf_score
            is_en = language == "en"
            ranked.append(
                (
                    fused,
                    {
                        "doc_id": doc.doc_id,
                        "category": doc.category,
                        "title": doc.title_en if is_en else doc.title_vi,
                        "snippet": doc.body_en if is_en else doc.body_vi,
                        "score": round(fused, 4),
                        "bm25_raw": round(bm25_raw[idx], 4),
                        "tfidf_score": round(tfidf_score, 4),
                        "suggested_route": doc.suggested_route,
                    },
                )
            )
        ranked.sort(key=lambda item: item[0], reverse=True)
        return [entry for score, entry in ranked[:top_k] if score > 0.05] or [ranked[0][1]]

    def extract_booking_slots(self, message: str, today: date | None = None) -> dict[str, Any]:
        ref_today = today or (datetime.now(timezone.utc) + timedelta(hours=7)).date()
        norm = _strip_accents(message)

        # 1. Room type matching
        room_type_id: int | None = None
        room_type_name: str | None = None
        for r_id, r_name, pat in ROOM_NAME_ALIASES:
            if pat.search(norm):
                room_type_id = r_id
                room_type_name = r_name
                break

        # 2. ISO or DMY dates
        iso_dates = re.findall(r"\b(20\d{2}-\d{2}-\d{2})\b", message)
        parsed_dates: list[date] = []
        for d_str in iso_dates:
            try:
                parsed_dates.append(date.fromisoformat(d_str))
            except ValueError:
                pass
        if len(parsed_dates) < 2:
            dmy = re.findall(r"\b(\d{1,2})/(\d{1,2})(?:/(20\d{2}))?\b", message)
            for dd, mm, yyyy in dmy:
                try:
                    yr = int(yyyy) if yyyy else ref_today.year
                    cand = date(yr, int(mm), int(dd))
                    if cand < ref_today and not yyyy:
                        cand = date(yr + 1, int(mm), int(dd))
                    parsed_dates.append(cand)
                except ValueError:
                    pass

        check_in_date: str | None = None
        check_out_date: str | None = None
        if len(parsed_dates) >= 2:
            d1, d2 = parsed_dates[0], parsed_dates[1]
            if d2 <= d1:
                d2 = d1 + timedelta(days=1)
            check_in_date = d1.isoformat()
            check_out_date = d2.isoformat()
        elif len(parsed_dates) == 1:
            check_in_date = parsed_dates[0].isoformat()
        elif re.search(r"\b(ngay mai|tomorrow)\b", norm):
            check_in_date = (ref_today + timedelta(days=1)).isoformat()
        elif re.search(r"\b(cuoi tuan|weekend)\b", norm):
            days_until_fri = (4 - ref_today.weekday()) % 7 or 7
            check_in_date = (ref_today + timedelta(days=days_until_fri)).isoformat()

        # Nights duration if check_out not yet explicit
        nights_match = re.search(r"\b(\d{1,2})\s*(dem|nights?)\b", norm)
        nights: int | None = int(nights_match.group(1)) if nights_match else None
        if nights is not None:
            nights = min(max(nights, 1), 30)
            if check_in_date and not check_out_date:
                check_out_date = (date.fromisoformat(check_in_date) + timedelta(days=nights)).isoformat()
        elif check_in_date and check_out_date:
            nights = max(1, (date.fromisoformat(check_out_date) - date.fromisoformat(check_in_date)).days)

        # 3. Guest count
        guest_count: int | None = None
        guest_match = re.search(r"\b(\d{1,2})\s*(khach|nguoi(\s*lon)?|guests?|adults?|pax)\b", norm)
        if guest_match:
            guest_count = min(max(int(guest_match.group(1)), 1), 10)
        elif re.search(r"\b(cap doi|couple|2 minh)\b", norm):
            guest_count = 2

        # 4. Coupon code
        coupon_code: str | None = None
        for known in ("WHITESAND10", "SUMMER15", "DIFF2026", "SUITE20"):
            if known in message.upper():
                coupon_code = known
                break
        if not coupon_code:
            code_match = re.search(r"\b(?:coupon|voucher|promo|ma)\s+([A-Z0-9]{5,16})\b", message.upper())
            if code_match:
                coupon_code = code_match.group(1)

        return {
            "room_type_id": room_type_id,
            "room_type_name": room_type_name,
            "check_in_date": check_in_date,
            "check_out_date": check_out_date,
            "nights": nights,
            "guest_count": guest_count,
            "coupon_code": coupon_code,
        }

    def ask(self, *, message: str, language: str | None = None) -> dict[str, Any]:
        raw = message.strip()
        lang = language or (
            "en"
            if re.match(
                r"^(hi\b|hello\b|hey\b|what\b|how\b|where\b|when\b|can\b|is\b|are\b|do\b|does\b|price\b|room\b|book\b|cancel\b)",
                raw,
                re.I,
            )
            else "vi"
        )
        slots = self.extract_booking_slots(raw)
        citations = self.retrieve(raw, top_k=3, language=lang)
        top_cat = citations[0]["category"] if citations else "general"
        return {
            "language": lang,
            "retriever": "hybrid_bm25_tfidf_v1",
            "top_category": top_cat,
            "slots": slots,
            "citations": citations,
        }

