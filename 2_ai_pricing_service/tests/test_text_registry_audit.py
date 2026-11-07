import importlib.util
import json
from pathlib import Path

import pytest


@pytest.fixture
def audit(tmp_path, monkeypatch):
    script = Path(__file__).resolve().parents[1] / "scripts/audit-text-registry.py"
    spec = importlib.util.spec_from_file_location("text_registry_test", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "directory", tmp_path)
    monkeypatch.setattr(module, "ledger", tmp_path / "requests.jsonl")
    return module


def test_corpus_domain_budget_is_separate_and_not_reset(audit):
    limit = audit.BUDGET["domain_request_overrides"].get("danang.gov.vn", audit.BUDGET["default_domain_requests"])
    audit.ledger.write_text('\n'.join(json.dumps({"kind": "request", "domain": "danang.gov.vn", "epoch": 0}) for _ in range(limit)))
    with pytest.raises(ValueError, match='budget exhausted'):
        audit.request('danang.gov.vn', 'https://danang.gov.vn/robots.txt')


def test_unapproved_redirect_domain_cannot_be_requested(audit):
    with pytest.raises(AssertionError):
        audit.request('danang.gov.vn', 'https://unapproved.example/robots.txt')


def test_persisted_block_cannot_be_retried_through_policy_discovery(audit, monkeypatch):
    (audit.directory / 'baodanang.vn.json').write_text(json.dumps({"status": "blocked"}))
    def unexpected(*args, **kwargs):
        raise AssertionError('No request permitted after block')
    monkeypatch.setattr(audit, 'request', unexpected)
    assert audit.audit('baodanang.vn')['status'] == 'blocked'


def test_policy_link_label_can_be_split_across_inline_tags(audit):
    parser = audit.PolicyLinks()
    parser.feed('<a href="/policy"><span>Điều</span><span> khoản Sử dụng</span></a>')
    assert parser.links == ['/policy']
