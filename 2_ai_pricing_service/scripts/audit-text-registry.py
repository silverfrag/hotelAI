"""M2 policy discovery only; no corpus extraction or LLM calls.

Budgets are separate from hotel-price feasibility: <=200 total; per-domain limits
come from the user-approved collection_budgets.json (50 default, gov override).
All redirects are stopped; blocked domains are never retried by this script.
"""
import hashlib
import json
import sys
import time
import unicodedata
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler
from urllib.robotparser import RobotFileParser

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / "2_ai_pricing_service"))
from app.services.market_evidence import public_https, PageText

DOMAINS = ("danangfantasticity.com", "startupdanang.vn", "danang.gov.vn",
           "cttdt.danangportal.gov.vn", "baodanang.vn")
AGENT = "HotelAI-Research/1.0"
directory = root / "artifacts/hotelai-ai-v1/20261029-092250/M2"
directory.mkdir(parents=True, exist_ok=True)
ledger = directory / "corpus-requests.jsonl"
BUDGET = json.loads((root / "2_ai_pricing_service/app/core/collection_budgets.json").read_text(encoding="utf8"))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class PolicyLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.href = None
        self.label = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.href = dict(attrs).get("href")
            self.label = []

    def handle_endtag(self, tag):
        if tag == "a":
            value = unicodedata.normalize("NFC", "".join(self.label) + (self.href or "")).lower()
            if self.href and any(word in value for word in
                    ("terms", "điều khoản", "dieu-khoan", "quy định sử dụng", "quy-dinh-su-dung", "dieu-kien")):
                self.links.append(self.href)
            self.href = None

    def handle_data(self, data):
        if self.href:
            self.label.append(data)


def request(domain, url, delay=5):
    assert domain in DOMAINS and urlparse(url).hostname == domain
    history = [json.loads(line) for line in ledger.read_text().splitlines()] if ledger.exists() else []
    attempts = [row for row in history if row["kind"] == "request"]
    same = [row for row in attempts if row["domain"] == domain]
    domain_limit = BUDGET["domain_request_overrides"].get(domain, BUDGET["default_domain_requests"])
    if len(attempts) >= BUDGET["total_requests"] or len(same) >= domain_limit:
        raise ValueError("Corpus request budget exhausted")
    if same:
        time.sleep(max(0, delay - (time.time() - same[-1]["epoch"])))
    event = {"domain": domain, "url": url, "epoch": time.time(),
             "observed_at": datetime.now(timezone.utc).isoformat(), "kind": "request"}
    def log(row):
        with ledger.open("a", encoding="utf8") as out:
            out.write(json.dumps(row) + "\n")
    log(event)
    result = {**event, "kind": "response"}
    text = ""
    try:
        public_https(url)
        with build_opener(ProxyHandler({}), NoRedirect()).open(Request(url, headers={"User-Agent": AGENT}), timeout=15) as response:
            body = response.read(2_000_001)
            result["http_status"] = response.status
            if len(body) > 2_000_000:
                raise ValueError("Response too large")
            result["sha256"] = hashlib.sha256(body).hexdigest()
            text = body.decode("utf8", errors="replace")
    except HTTPError as error:
        result["http_status"] = error.code
        if error.code == 429:
            result["retry_after"] = error.headers.get("Retry-After")
        # Do not store challenge bodies, cookie headers or redirect query tokens.
        if error.code in (301, 302, 303, 307, 308):
            location = urljoin(url, error.headers.get("Location", ""))
            parsed = urlparse(location)
            result["redirect_host"] = parsed.hostname
            if parsed.scheme == "https" and parsed.hostname == domain and not parsed.query and not parsed.username:
                result["same_domain_redirect_url"] = location.split("#")[0]
    except Exception as error:
        result["error_type"] = type(error).__name__
    log(result)
    return result, text


def audit(domain):
    state_file = directory / (domain + ".json")
    if state_file.exists():
        return json.loads(state_file.read_text(encoding="utf8"))
    base = "https://" + domain + "/"
    record, robots = request(domain, base + "robots.txt")
    state = {"domain": domain, "status": "policy_review_pending", "evidence": [record],
             "corpus_documents_collected": 0, "automatic_collection_permission_established": False}
    status = record.get("http_status")
    if status in (401, 403):
        state.update(status="blocked", reason="access_blocked_at_robots")
    elif status != 200 or "<html" in robots.lower():
        state.update(status="insufficient_data", reason="robots_unavailable_or_redirect_or_html")
    else:
        (directory / (domain + ".robots.txt")).write_text(robots, encoding="utf8")
        parser = RobotFileParser(base + "robots.txt")
        parser.parse(robots.splitlines())
        delay = max(5, parser.crawl_delay(AGENT) or parser.crawl_delay("*") or 0)
        rate = parser.request_rate(AGENT) or parser.request_rate("*")
        if rate:
            delay = max(delay, rate.seconds / rate.requests)
        if not parser.can_fetch(AGENT, base):
            state.update(status="blocked", reason="robots_disallows_landing_page")
        elif delay > 60:
            state.update(status="insufficient_data", reason="stricter_rate_requires_deferred_review")
        else:
            home, html = request(domain, base, delay)
            state["evidence"].append(home)
            if home.get("http_status") in (401, 403):
                state.update(status="blocked", reason="landing_access_blocked")
            elif home.get("http_status") != 200:
                state.update(status="insufficient_data", reason="landing_unavailable_or_redirect")
            else:
                visible = PageText()
                visible.feed(html)
                text = visible.text()
                challenge = next((marker for marker in ("verify you are human", "checking your browser",
                    "enable javascript and cookies to continue") if marker in text.lower()), None)
                if challenge:
                    state.update(status="blocked", reason="visible_access_challenge", challenge_excerpt=challenge)
                else:
                    links = PolicyLinks()
                    links.feed(html)
                    candidates = sorted({urljoin(base, href).split("#")[0] for href in links.links})
                    candidates = [url for url in candidates if urlparse(url).scheme == "https"
                                  and urlparse(url).hostname == domain and not urlparse(url).query
                                  and parser.can_fetch(AGENT, url)]
                    state["policy_candidates"] = candidates
                    if candidates:
                        policy, policy_html = request(domain, candidates[0], delay)
                        state["evidence"].append(policy)
                        if policy.get("http_status") in (401, 403):
                            state.update(status="blocked", reason="policy_access_blocked")
                        elif policy.get("http_status") == 200:
                            parsed = PageText()
                            parsed.feed(policy_html)
                            # Store policy text only, never executable HTML or cookies.
                            (directory / (domain + ".policy.txt")).write_text(parsed.text(), encoding="utf8")
                    state.setdefault("reason", "manual_review_of_terms_required_before_corpus_collection")
    state_file.write_text(json.dumps(state, indent=2), encoding="utf8")
    return state


if __name__ == "__main__":
    lock = directory / "policy-audit.lock"
    lock.open("x").close()
    try:
        print(json.dumps([audit(domain) for domain in DOMAINS], indent=2))
    finally:
        lock.unlink()
