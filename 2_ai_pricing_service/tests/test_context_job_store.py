"""Durable local jobs use test fixtures; no corpus/model calls in this suite."""
import json
from datetime import date

import pytest

from app.services.context_job_store import ContextJobStore
from app.services.market_context import GroundedContextAnalyzer


def test_completed_cache_survives_restart_without_refreshing_age(tmp_path, monkeypatch):
    monkeypatch.setattr('app.services.context_job_store.time.time', lambda: 1000)
    store = ContextJobStore(tmp_path)
    store.save(('fixture',), [], 'completed', result=[{'events': []}, {'provider': 'test_fixture'}])
    monkeypatch.setattr('app.services.context_job_store.time.time', lambda: 1800)
    assert ContextJobStore(tmp_path).completed(('fixture',))[0] == {'events': []}
    assert store.read(('fixture',))['updated_at_epoch'] == 1000
    monkeypatch.setattr('app.services.context_job_store.time.time', lambda: 1901)
    assert store.completed(('fixture',)) is None


@pytest.mark.parametrize('raw', ['[]', '{}', '{', '{"schema_version":1,"key":null}'])
def test_corrupt_checkpoint_is_not_work(tmp_path, raw):
    store = ContextJobStore(tmp_path)
    store.path(('fixture',)).write_text(raw, encoding='utf8')
    assert store.read(('fixture',)) is None
    assert store.completed(('fixture',)) is None
    assert store.resumable() == []


def test_only_recent_pending_jobs_resume_and_payload_is_bounded(tmp_path, monkeypatch):
    store = ContextJobStore(tmp_path)
    monkeypatch.setattr('app.services.context_job_store.time.time', lambda: 1000)
    store.save(('old',), [], 'running')
    monkeypatch.setattr('app.services.context_job_store.time.time', lambda: 2000)
    store.save(('new',), [], 'queued')
    store.save(('done',), [], 'completed', result=[{'events': []}, {}])
    assert [job['key'] for job in store.resumable()] == [['new']]
    with pytest.raises(ValueError, match='size budget'):
        store.save(('oversized',), [{'text': 'x' * store.max_bytes}], 'queued')
    assert not store.path(('oversized',)).exists()


def test_analyzer_restores_completed_result_without_model_call(tmp_path, monkeypatch):
    monkeypatch.setenv('MARKET_CONTEXT_PROVIDER', 'ollama')
    monkeypatch.setenv('MARKET_CONTEXT_MODEL', 'test_fixture')
    evidence = {'documents': [{'kind': 'events', 'source_id': 'fixture', 'text': 'No dated facts.'}]}
    calls = []
    def complete(self, documents):
        calls.append(documents)
        return {'events': []}, {'provider': 'test_fixture'}
    monkeypatch.setattr(GroundedContextAnalyzer, '_complete', complete)
    first = GroundedContextAnalyzer(store_dir=tmp_path)
    first.analyze(evidence, date(2026, 11, 7))
    first._executor.shutdown(wait=True)
    assert first.analyze(evidence, date(2026, 11, 7))['status'] == 'extracted'
    second = GroundedContextAnalyzer(store_dir=tmp_path)
    try:
        result = second.analyze(evidence, date(2026, 11, 7))
        assert result['status'] == 'extracted'
        assert result['inference']['cache_status'] == 'persistent'
        assert len(calls) == 1
    finally:
        second._executor.shutdown(wait=True)


def test_analyzer_recovers_queued_job_after_restart(tmp_path, monkeypatch):
    from app.services.market_context import CONTEXT_VERSION
    from app.services.local_market_context import RUNTIME
    monkeypatch.setenv('MARKET_CONTEXT_PROVIDER', 'ollama')
    monkeypatch.setenv('MARKET_CONTEXT_MODEL', 'test_fixture')
    key = (CONTEXT_VERSION, 'test_fixture', RUNTIME['version'], RUNTIME['digest'], 'fixture_hash')
    store = ContextJobStore(tmp_path)
    store.save(key, [], 'queued')
    monkeypatch.setattr(GroundedContextAnalyzer, '_complete', lambda self, docs: ({'events': []}, {}))
    analyzer = GroundedContextAnalyzer(store_dir=tmp_path)
    analyzer._executor.shutdown(wait=True)
    assert store.read(key)['status'] == 'completed'
    assert store.completed(key)[0] == {'events': []}
