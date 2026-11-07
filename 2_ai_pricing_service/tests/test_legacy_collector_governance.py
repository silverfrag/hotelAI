from app.services.market_evidence import EvidenceCollector


def test_preview_cannot_bypass_v1_source_quarantine_or_budgets(monkeypatch, tmp_path):
    monkeypatch.setenv('MARKET_LEGACY_COLLECTION_DISABLED', '1')
    def forbidden(*args, **kwargs):
        raise AssertionError('Legacy preview must not access external sources')
    result = EvidenceCollector(fetcher=forbidden, cache_dir=tmp_path).collect(None)
    assert result['weather'] is None and result['documents'] == [] and result['comparable_rates'] == []
    assert result['collection_status'] == 'disabled_pending_governed_jobs'
