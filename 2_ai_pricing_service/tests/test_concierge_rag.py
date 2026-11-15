from __future__ import annotations

from datetime import date
from fastapi.testclient import TestClient

from app.main import app
from app.services.concierge_rag import HybridConciergeRagService


def test_hybrid_bm25_tfidf_retrieves_grounded_docs():
    rag = HybridConciergeRagService()
    res_spa = rag.ask(message="Spa tầng mấy và khách ở có được giảm giá không?", language="vi")
    assert res_spa["retriever"] == "hybrid_bm25_tfidf_v1"
    assert res_spa["citations"][0]["doc_id"] == "WS-WEL-03"
    assert res_spa["citations"][0]["score"] > 0.2

    res_loc = rag.ask(message="How far from My Khe beach and airport?", language="en")
    assert res_loc["citations"][0]["doc_id"] == "WS-LOC-01"
    assert res_loc["language"] == "en"


def test_bilingual_slot_extraction_dates_room_guests_coupon():
    rag = HybridConciergeRagService()
    slots = rag.extract_booking_slots(
        "Cho tôi hỏi phòng Suite ngày mai ở 2 đêm cho 2 khách với mã SUITE20",
        today=date(2026, 11, 12),
    )
    assert slots["room_type_id"] == 5
    assert slots["room_type_name"] == "Suite"
    assert slots["check_in_date"] == "2026-11-13"
    assert slots["check_out_date"] == "2026-11-15"
    assert slots["nights"] == 2
    assert slots["guest_count"] == 2
    assert slots["coupon_code"] == "SUITE20"


def test_concierge_ask_fastapi_endpoint():
    client = TestClient(app)
    r = client.post(
        "/api/v1/concierge/ask",
        json={"message": "Phòng Deluxe ngày 2026-12-10 đến 2026-12-12 2 khách mã DIFF2026", "language": "vi"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["slots"]["room_type_id"] == 2
    assert body["slots"]["check_in_date"] == "2026-12-10"
    assert body["slots"]["check_out_date"] == "2026-12-12"
    assert body["slots"]["coupon_code"] == "DIFF2026"
    assert len(body["citations"]) >= 1

