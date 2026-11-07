import importlib.util
import json
from pathlib import Path

import pytest


@pytest.fixture
def survey(tmp_path, monkeypatch):
    script = Path(__file__).resolve().parents[1] / "scripts/survey-hotel-sources.py"
    spec = importlib.util.spec_from_file_location("hotel_survey_test", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "evidence", tmp_path)
    monkeypatch.setattr(module, "ledger", tmp_path / "requests.jsonl")
    return module


def test_contact_form_recaptcha_is_not_an_access_block(survey):
    html = '<script src="https://example.com/recaptcha.js"></script><p>Book a room at our hotel</p>'
    assert survey.challenge_excerpt(html) is None
    assert survey.challenge_excerpt('<h1>Verify you are human</h1>') == 'verify you are human'


def test_robots_deny_stops_before_landing_page(survey, monkeypatch):
    calls = []
    def fetch(source, url):
        calls.append(url)
        return {"http_status": 200, "observed_at": "test_fixture"}, 'User-agent: *\nDisallow: /'
    monkeypatch.setattr(survey, "fetch", fetch)
    assert survey.survey('pullman')['status'] == 'blocked'
    assert len(calls) == 1
    survey.survey('pullman')
    assert len(calls) == 1  # No request after a persisted block.


def test_twentieth_attempt_cannot_be_reset_by_rerunning(survey, monkeypatch):
    survey.ledger.write_text('\n'.join(json.dumps({"source": "pullman", "kind": "request", "epoch": 0}) for _ in range(20)))
    with pytest.raises(ValueError, match='exhausted'):
        survey.fetch('pullman', 'https://www.pullman-danang.com/robots.txt')


def test_http_403_stops_source_without_fetching_other_paths(survey, monkeypatch):
    calls = []
    def fetch(source, url):
        calls.append(url)
        return {"http_status": 403, "observed_at": "test_fixture"}, ''
    monkeypatch.setattr(survey, 'fetch', fetch)
    assert survey.survey('haian')['status'] == 'blocked'
    assert len(calls) == 1
