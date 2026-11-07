from datetime import date

from app.services.market_context import GroundedContextAnalyzer


def test_travel_disruption_is_not_counted_as_a_festival():
    quote = 'Đà Nẵng tạm cấm đường từ ngày 30-12-2026 đến ngày 3-1-2027.'
    fact = {"fact_type": "travel_disruption", "source_id": "test_fixture", "title": "Tạm cấm đường",
            "quote": quote, "location_quote": "Đà Nẵng", "start_date": "2026-12-30", "end_date": "2027-01-03",
            "start_date_quote": "30-12-2026", "end_date_quote": "3-1-2027"}
    analyzer = GroundedContextAnalyzer(completion=lambda docs: {"events": [fact]})
    try:
        result = analyzer.analyze({"documents": [{"kind": "events", "source_id": "test_fixture",
            "text": 'Tạm cấm đường\n' + quote}]}, date(2026, 12, 31))
        assert result['status'] == 'extracted'
        assert result['events'] == []
        assert result['facts'][0]['fact_type'] == 'travel_disruption'
    finally:
        analyzer._executor.shutdown(wait=True)


def test_cancelled_event_and_conflicting_status_are_not_active_features():
    quote = 'Hội chợ A tại Đà Nẵng từ 15-11-2026 đến 17-11-2026.'
    cancellation = 'Thông báo hủy Hội chợ A.'
    base = {'fact_type': 'event', 'source_id': 'test_fixture', 'title': 'Hội chợ A',
            'quote': quote, 'location_quote': 'Đà Nẵng', 'start_date': '2026-11-15',
            'end_date': '2026-11-17', 'start_date_quote': '15-11-2026', 'end_date_quote': '17-11-2026'}
    documents = [{'kind': 'events', 'source_id': 'test_fixture', 'text': quote + '\n' + cancellation}]
    for facts, conflict_count in [([base | {'event_status': 'cancelled', 'status_quote': cancellation}], 0),
                                 ([base, base | {'event_status': 'cancelled', 'status_quote': cancellation}], 1)]:
        analyzer = GroundedContextAnalyzer(completion=lambda docs: {'events': facts})
        try:
            result = analyzer.analyze({'documents': documents}, date(2026, 11, 16))
            assert result['events'] == []
            assert len(result['conflicts']) == conflict_count
            assert len(result['facts']) == len(facts)
        finally:
            analyzer._executor.shutdown(wait=True)
