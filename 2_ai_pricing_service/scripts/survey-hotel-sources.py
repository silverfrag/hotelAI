"""Bounded M1 feasibility inspection; no browser, accounts or bypass mechanisms.

Only robots and an allowed public landing page are inspected here. This script
does not claim to implement operational rate collection or grant ToS permission.
"""
import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler
from urllib.robotparser import RobotFileParser

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / "2_ai_pricing_service"))
from app.services.market_evidence import public_https, PageText

REGISTRY = {
    "pullman": "https://www.pullman-danang.com/",
    "intercontinental": "https://www.danang.intercontinental.com/",
    "haian": "https://haianbeachhotelspa.com/",
    "monarque": "https://monarquehotel.vn/",
}
agent = "HotelAI-Research/1.0"
evidence = root / "artifacts/hotelai-ai-v1/20261029-092250/M1"
evidence.mkdir(parents=True, exist_ok=True)
ledger = evidence / "price-feasibility-requests.jsonl"


def challenge_excerpt(html):
    parser = PageText()
    parser.feed(html)
    visible = parser.text()
    # A hotel's contact form may embed reCAPTCHA scripts; that is not evidence
    # that access to the page was blocked. Inspect visible challenge messages.
    for marker in ("verify you are human", "checking your browser", "access denied",
                   "enable javascript and cookies to continue"):
        if marker in visible.lower():
            return marker
    return None


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def write_event(event):
    with ledger.open("a", encoding="utf8") as out:
        out.write(json.dumps(event, ensure_ascii=True) + "\n")


def fetch(source, url):
    history = [json.loads(line) for line in ledger.read_text().splitlines()] if ledger.exists() else []
    attempts = [row for row in history if row["source"] == source and row["kind"] == "request"]
    if len(attempts) >= 20:
        raise ValueError("Source feasibility budget exhausted")
    if attempts:
        time.sleep(max(0, 5 - (time.time() - attempts[-1]["epoch"])))
    observed = datetime.now(timezone.utc).isoformat()
    event = {"source": source, "kind": "request", "url": url, "observed_at": observed, "epoch": time.time()}
    write_event(event)  # Count attempts even if the connection fails.
    result = {**event, "kind": "response"}
    try:
        public_https(url)
        request = Request(url, headers={"User-Agent": agent, "Accept": "text/html,text/plain"})
        with build_opener(ProxyHandler({}), NoRedirect()).open(request, timeout=15) as response:
            body = response.read(2_000_001)
            result["http_status"] = response.status
        if len(body) > 2_000_000:
            result["reason"] = "response_size_limit"
            body = b""
    except HTTPError as error:
        result["http_status"] = error.code
        # Never persist challenge HTML, cookies, headers or tokens.
        body = b""
        if error.code == 429:
            result["retry_after"] = error.headers.get("Retry-After")
        if error.code in (301, 302, 303, 307, 308):
            target = urlparse(error.headers.get("Location", ""))
            result["redirect_host"] = target.hostname
            result["reason"] = "redirect_not_followed; requires policy review"
    except Exception as error:
        result["http_status"] = None
        result["reason"] = type(error).__name__
        body = b""
    result["response_sha256"] = hashlib.sha256(body).hexdigest() if body else None
    write_event(result)
    return result, body.decode("utf8", errors="replace")


def survey(source):
    state_file = evidence / f"{source}.json"
    if state_file.exists():
        previous = json.loads(state_file.read_text())
        if previous["status"] in ("blocked", "insufficient_data"):
            return previous  # No reset/retry through another invocation.
    base = REGISTRY[source]
    robots_url = base + "robots.txt"
    record, text = fetch(source, robots_url)
    state = {"source": source, "base_url": base, "observed_at": record["observed_at"],
             "status": "insufficient_data", "evidence": [record], "qualified_rate_observations": 0}
    if record["http_status"] in (401, 403):
        state.update(status="blocked", reason="access_blocked_at_robots")
    elif record["http_status"] != 200:
        state["reason"] = "robots_unavailable_or_redirect; automatic access not established"
    elif "<html" in text.lower():
        state.update(status="blocked", reason="challenge_or_html_at_robots")
    else:
        (evidence / f"{source}.robots.txt").write_text(text, encoding="utf8")
        parser = RobotFileParser(robots_url)
        parser.parse(text.splitlines())
        delay = parser.crawl_delay(agent) or parser.crawl_delay("*") or 0
        if not parser.can_fetch(agent, base):
            state.update(status="blocked", reason="robots_disallows_landing_page")
        else:
            # Respect stricter crawl delay; no booking/rate URLs until ToS reviewed.
            rate = parser.request_rate(agent) or parser.request_rate("*")
            if delay > 60 or (rate and rate.seconds / rate.requests > 60):
                state["reason"] = "stricter_robots_rate_requires_deferred_review"
                state_file.write_text(json.dumps(state, indent=2), encoding="utf8")
                return state
            if rate:
                delay = max(delay, rate.seconds / rate.requests)
            if delay > 5:
                time.sleep(delay)
            page_record, page = fetch(source, base)
            state["evidence"].append(page_record)
            challenge = challenge_excerpt(page)
            if page_record["http_status"] in (401, 403) or challenge:
                state.update(status="blocked", reason="landing_page_access_blocked")
                if challenge:
                    state["challenge_excerpt"] = challenge
            elif page_record["http_status"] != 200:
                state["reason"] = "landing_page_unavailable_or_redirect"
            else:
                parser = PageText()
                parser.feed(page)
                # No arbitrary URLs accepted from a browser. Only the fixed registry above.
                safe_text = parser.text()
                state["landing_excerpt"] = safe_text[:1200]
                state["reason"] = "no_verified_stay_specific_rates; ToS and booking engine review required"
    state_file.write_text(json.dumps(state, indent=2, ensure_ascii=True), encoding="utf8")
    return state


if __name__ == "__main__":
    # An exclusive lock avoids concurrent invocations accidentally sharing a budget.
    lock = evidence / "survey.lock"
    lock.open("x").close()
    try:
        results = [survey(source) for source in REGISTRY]
        print(json.dumps(results, indent=2, ensure_ascii=True))
    finally:
        lock.unlink()
