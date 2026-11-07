"""Local transport and background behavior; all sample text is test-only."""
import json
import threading
from datetime import date

import pytest

from app.services.local_market_context import complete_local, local_endpoint, selected_documents, resolve_links
from app.services.market_context import GroundedContextAnalyzer


@pytest.mark.parametrize("url", ["https://example.com/api/chat", "http://192.168.1.2:11434/api/chat",
    "http://localhost:11434/api/chat", "http://127.0.0.1:11434/other",
    "http://user:pass@127.0.0.1:11434/api/chat", "http://127.0.0.1:11434/api/chat?redirect=x"])
def test_local_endpoint_is_explicit_loopback_only(monkeypatch, url):
    monkeypatch.setenv("MARKET_CONTEXT_OLLAMA_URL", url)
    with pytest.raises(ValueError):
        local_endpoint()


def test_local_budget_is_explicit():
    documents = [{"source_id": str(i), "text": "28/10/2026 " + "x" * 6989} for i in range(8)]
    selected = selected_documents(documents)
    assert len(selected) == 2
    assert sum(len(d["text"]) for d in selected) == 6000
    assert len(documents[0]["text"]) == 7000


def test_publication_metadata_is_not_a_candidate_date_but_occurrence_is():
    selected = selected_documents([{'source_id': 'fixture', 'text':
        'Hội chợ A\n07/11/2026 09:30 , Lượt xem: 12\nĐà Nẵng tổ chức từ 15-11-2026 đến 17-11-2026.'}])
    assert '07/11/2026' not in selected[0]['text']
    assert '15-11-2026' in selected[0]['text']


def test_background_job_is_deduplicated_and_filters_target_date(monkeypatch):
    monkeypatch.setenv("MARKET_CONTEXT_PROVIDER", "ollama")
    monkeypatch.setenv("MARKET_CONTEXT_MODEL", "test-only")
    gate = threading.Event()
    calls = []
    def completion(documents):
        calls.append(documents)
        gate.wait(timeout=3)
        return {"events": []}, {"provider": "test-only"}
    analyzer = GroundedContextAnalyzer()
    monkeypatch.setattr(analyzer, "_complete", completion)
    evidence = {"documents": [{"kind": "events", "source_id": "test", "text": "test fixture"}]}
    try:
        assert analyzer.analyze(evidence, date(2026, 10, 29))["status"] == "analyzing"
        assert analyzer.analyze(evidence, date(2026, 10, 30))["status"] == "analyzing"
        gate.set()
        analyzer._executor.shutdown(wait=True)
        result = analyzer.analyze(evidence, date(2026, 10, 29))
        assert result["status"] == "extracted" and len(calls) == 1
        assert result["inference"]["provider"] == "test-only"
    finally:
        gate.set()
        analyzer._executor.shutdown(wait=True)


def test_failed_local_job_does_not_look_like_empty_extraction(monkeypatch):
    monkeypatch.setenv("MARKET_CONTEXT_PROVIDER", "ollama")
    monkeypatch.setenv("MARKET_CONTEXT_MODEL", "test-only")
    analyzer = GroundedContextAnalyzer()
    def failure(documents):
        raise TimeoutError("not exposed")
    monkeypatch.setattr(analyzer, "_complete", failure)
    evidence = {"documents": [{"kind": "events", "source_id": "test", "text": "test fixture"}]}
    analyzer.analyze(evidence, date(2026, 10, 29))
    analyzer._executor.shutdown(wait=True)
    result = analyzer.analyze(evidence, date(2026, 10, 29))
    assert result["status"] == "extraction_failed" and result["error_type"] == "TimeoutError"


@pytest.mark.parametrize("reason", ["length", "stop"])
def test_ollama_structured_transport_rejects_truncation(monkeypatch, tmp_path, reason):
    monkeypatch.setenv("MARKET_CONTEXT_MODEL", "test-only")
    monkeypatch.setenv("MARKET_CONTEXT_OUTPUT_DIR", str(tmp_path))
    requests = []
    class Response:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def read(self, limit):
            return json.dumps({"done": True, "done_reason": reason,
                               "message": {"content": '{"events":[]}'}}).encode()
    class Opener:
        def open(self, request, timeout):
            requests.append(json.loads(request.data))
            assert "Authorization" not in request.headers
            return Response()
    monkeypatch.setattr("app.services.local_market_context.build_opener", lambda *handlers: Opener())
    if reason == "length":
        with pytest.raises(ValueError, match="Incomplete"):
            complete_local([], "test prompt")
    else:
        result, metadata = complete_local([], "test prompt")
        assert result == {"events": []} and metadata["provider"] == "ollama_local"
    assert requests[0]["think"] is False and requests[0]["stream"] is False
    assert requests[0]["format"]["type"] == "object"


@pytest.mark.parametrize("change", [{}, {"time_span": 0}, {"source_id": "invented"},
                                  {"start_date_quote": "27/10/2026"}, {"location_span": 99}])
def test_evidence_pointers_cannot_invent_or_repair_facts(change):
    documents = [{"source_id": "fixture", "text": "Sự kiện thử nghiệm\nĐịa điểm: Đà Nẵng.\nTừ 28/10/2026 đến 30/10/2026."}]
    link = {"source_id": "fixture", "title_span": 0, "location_span": 1, "time_span": 2,
            "start_date_quote": "28/10/2026", "end_date_quote": "30/10/2026"} | change
    output, rejected = resolve_links({"events": [link]}, documents)
    if change:
        assert rejected == 1 and output["events"] == []
    else:
        assert rejected == 0
        event = output["events"][0]
        assert event["title"] == "Sự kiện thử nghiệm" and event["start_date"] == "2026-10-28"
        assert event["quote"] == documents[0]["text"].splitlines()[2]


def test_same_time_and_location_passage_cannot_inflate_event_count():
    documents = [{"source_id": "fixture", "text": "Sự kiện thử nghiệm\nĐà Nẵng\nTừ 28/10/2026 đến 30/10/2026.\nĐối tượng tham gia"}]
    link = {"source_id": "fixture", "title_span": 0, "location_span": 1, "time_span": 2,
            "start_date_quote": "28/10/2026", "end_date_quote": "30/10/2026"}
    output, rejected = resolve_links({"events": [link, link | {"title_span": 3}]}, documents)
    assert len(output["events"]) == 1 and rejected == 0
