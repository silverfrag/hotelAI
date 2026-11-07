"""Collect up to 40 review candidates within the CURRENT approved domain budget.

No labels, train/test split, quality score or market observations are fabricated.
Only the inspected gov source is eligible; this is not an operational refresher.
"""
import importlib.util
import hashlib
import json
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

root = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("corpus_policy", Path(__file__).with_name("audit-text-registry.py"))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)
directory = policy.directory / "reference-candidates"
directory.mkdir(exist_ok=True)


def bounded_article_text(text):
    # The source renders recommendations and CMS metadata after this widget.
    # Exclude them so another article's dates cannot become this article's facts.
    marker = "Đánh giá bài viết:"
    if marker not in text:
        return None
    article = text.split(marker, 1)[0].strip()
    return article if len(article) >= 80 else None


class ArticleText(policy.PageText):
    """Keep original visible text and candidate DOM regions for human review."""
    def __init__(self):
        super().__init__()
        self.classes = set()
        self.heading = []
        self.in_heading = False
        self.region = None
        self.region_depth = 0
        self.article_regions = []

    def handle_starttag(self, tag, attrs):
        super().handle_starttag(tag, attrs)
        values = dict(attrs)
        if self.region is None and tag == "div" and "detail__main" in values.get("class", "").split():
            self.region = policy.PageText()
            self.region_depth = 1
        elif self.region is not None and tag == "div":
            self.region_depth += 1
        if self.region is not None:
            self.region.handle_starttag(tag, attrs)
        self.classes.update(value for value in values.get("class", "").split()
                            if any(word in value.lower() for word in ("article", "detail", "journal", "news-content")))
        if tag == "h1":
            self.in_heading = True

    def handle_endtag(self, tag):
        super().handle_endtag(tag)
        if self.region is not None:
            self.region.handle_endtag(tag)
            if tag == "div":
                self.region_depth -= 1
                if self.region_depth == 0:
                    self.article_regions.append(self.region.text())
                    self.region = None
        if tag == "h1":
            self.in_heading = False

    def handle_data(self, data):
        super().handle_data(data)
        if self.region is not None:
            self.region.handle_data(data)
        if self.in_heading and data.strip():
            self.heading.append(data.strip())


def collect(limit, discovery="home"):
    state_file = policy.directory / "danang.gov.vn.json"
    state = json.loads(state_file.read_text(encoding="utf-8-sig"))
    if state["status"] != "eligible_with_attribution":
        raise ValueError("Source permission review not passed or source stopped")
    robots = RobotFileParser()
    robots.parse((policy.directory / "danang.gov.vn.robots.txt").read_text().splitlines())
    filename = "danang.gov.vn.tourism-links.json" if discovery == "tourism" else "danang.gov.vn.discovery-links.json"
    urls = json.loads((policy.directory / filename).read_text())
    urls = [url for url in urls if urlparse(url).hostname == "danang.gov.vn"
            and urlparse(url).path.startswith("/web/dng/-/") and not urlparse(url).query
            and not any(word in url for word in ("/-/video-", "/-/anh-", "/-/infographic-"))]
    keywords = ("le-hoi", "hoi-nghi", "trien-lam", "su-kien", "dien-dan", "ngay-hoi", "duong-bay", "lien-hoan")
    topical = [url for url in urls if any(word in url for word in keywords)]
    other = [url for url in urls if url not in topical]
    # Topic selection is declared; it is not a claim of positive gold labels.
    candidates = list(dict.fromkeys(topical[:24] + other[:16] + topical[24:] + other[16:]))
    completed = 0
    for url in candidates:
        discovered_url = url
        # Same-host canonical URL pattern observed in the source's own 302.
        # No credentials, tokens, alternate hosts or challenge handling involved.
        url = url.replace("/web/dng/-/", "/vi/web/dng/w/", 1)
        identifier = hashlib.sha256(url.encode()).hexdigest()[:20]
        target = directory / (identifier + ".json")
        if target.exists() or not robots.can_fetch(policy.AGENT, url):
            continue
        result, html = policy.request("danang.gov.vn", url, 5)
        if result.get("http_status") in (401, 403):
            state.update(status="blocked", reason="access_blocked_during_corpus_collection")
            state["evidence"].append(result)
            state_file.write_text(json.dumps(state, indent=2), encoding="utf8")
            break
        record = {"source_url": url, "source_name": "Cổng Thông tin điện tử thành phố Đà Nẵng",
                  "discovered_url": discovered_url,
                  "source_attribution": "danang.gov.vn", "observed_at": result["observed_at"],
                  "source_http_status": result.get("http_status"), "raw_response_sha256": result.get("sha256"),
                  "dataset_role": "unreviewed_reference_candidate", "gold_labels": None,
                  "review_status": "pending", "official_evaluation_eligible": False,
                  "operational_conversion_data": False, "input_provenance": "real_public_source"}
        if result.get("http_status") == 200:
            parser = ArticleText()
            parser.feed(html)
            text = parser.text()
            challenge = next((marker for marker in ("verify you are human", "checking your browser",
                "enable javascript and cookies to continue") if marker in text.lower()), None)
            if challenge:
                state.update(status="blocked", reason="visible_access_challenge_during_corpus_collection")
                state["evidence"].append(result | {"challenge_excerpt": challenge})
                state_file.write_text(json.dumps(state, indent=2), encoding="utf8")
                break
            record.update(visible_page_text=text, visible_text_sha256=hashlib.sha256(text.encode()).hexdigest(),
                          headings=parser.heading, article_dom_classes=sorted(parser.classes),
                          extraction_scope="full_visible_page; article boundary still needs review")
            if parser.article_regions:
                article = bounded_article_text(max(parser.article_regions, key=len))
                if article:
                    record.update(article_text=article, article_text_sha256=hashlib.sha256(article.encode()).hexdigest(),
                                  extraction_scope="detail__main before rating widget; human boundary review pending")
        target.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf8")
        completed += 1
        print(json.dumps({"candidate": identifier, "http": record["source_http_status"], "count": completed}), flush=True)
        if completed >= limit:
            break


if __name__ == "__main__":
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    if not 1 <= limit <= 40:
        raise ValueError("At most 40 candidates per explicit invocation; domain budget remains enforced")
    lock = policy.directory / "policy-audit.lock"
    lock.open("x").close()
    try:
        collect(limit, "tourism" if "--tourism" in sys.argv[2:] else "home")
    finally:
        lock.unlink()
