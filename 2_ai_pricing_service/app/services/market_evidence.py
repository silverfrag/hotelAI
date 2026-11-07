"""Fetch real public evidence; never replace missing observations with demo data.

URLs are operator-configured, never request-controlled. Raw responses are hashed
and cached for reproducibility. Public promotional pages are documents, NOT
date-specific, comparable room quotes. Only the stricter provider contract can
enter the competitor median used by a learned conversion model.
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from app.schemas.market_pricing_schema import ComparableRate, SourceEvidence

DEFAULT_SOURCES = [
    {"id": "danang-trade-program-2026", "name": "Đà Nẵng · Chương trình giao thương 2026", "kind": "events",
     "url": "https://startupdanang.vn/thong-bao-moi-doanh-nghiep-dang-ky-tham-gia-chuong-trinh-doan-doanh-nghiep-nuoc-ngoai-vao-thanh-pho-da-nang-giao-dich-de-mua-hang-nam-2026"},
    {"id": "danang-tourism", "name": "Cổng du lịch Đà Nẵng", "kind": "events",
     "url": "https://danangfantasticity.com/"},
    {"id": "pullman-danang", "name": "Pullman Danang Beach Resort", "kind": "hotel_page",
     "url": "https://www.pullman-danang.com/special-offers/?category=rooms"},
    {"id": "intercontinental-danang", "name": "InterContinental Danang", "kind": "hotel_page",
     "url": "https://www.danang.intercontinental.com/offers/"},
]


def utc_now():
    return datetime.now(timezone.utc)


def public_https(url: str):
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError("Public HTTPS URL required")
    addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError("Private/reserved source address is not permitted")


class PublicRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        public_https(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_public(url: str) -> bytes:
    public_https(url)
    request = Request(url, headers={"User-Agent": "HotelAI-AcademicEvidence/1.0", "Accept": "text/html,application/json"})
    with build_opener(PublicRedirects()).open(request, timeout=4) as response:
        content = response.read(2_000_001)
    if len(content) > 2_000_000:
        raise ValueError("Source exceeds 2 MB limit")
    return content


class PageText(HTMLParser):
    blocks = {"p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "div", "tr", "br", "title"}
    def __init__(self):
        super().__init__()
        self.hidden = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript"}:
            self.hidden += 1
        if not self.hidden and tag in self.blocks:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript"}:
            self.hidden = max(0, self.hidden - 1)
        if not self.hidden and tag in self.blocks:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.hidden and data.strip():
            self.parts.append(data.strip())

    def text(self):
        # Keep inline tags within the same paragraph, retaining block boundaries
        # so a tiny local model need not reconnect dozens of formatting fragments.
        return "\n".join(line.strip() for line in " ".join(self.parts).splitlines() if line.strip())


class EvidenceCollector:
    def __init__(self, *, fetcher=fetch_public, sources=None, cache_dir=None, now=utc_now):
        self.fetcher, self.now = fetcher, now
        registry = os.getenv("MARKET_SOURCES_PATH")
        self.sources = sources if sources is not None else (
            json.loads(Path(registry).read_text(encoding="utf8")) if registry else DEFAULT_SOURCES
        )
        if len(self.sources) > 8 or len({s["id"] for s in self.sources}) != len(self.sources):
            raise ValueError("Source registry must contain at most 8 unique sources")
        if any(s["kind"] not in {"events", "hotel_page", "rates_json"} for s in self.sources):
            raise ValueError("Unsupported source kind")
        self.cache_dir = Path(cache_dir or os.getenv("MARKET_EVIDENCE_DIR", ".tmp/market-evidence"))
        self._cache = {}
        self._lock = threading.Lock()

    def _get(self, source):
        key = source["url"]
        with self._lock:
            cached = self._cache.get(key)
        if cached and time.monotonic() - cached[0] < 900:
            return cached[1], cached[2], "cached"
        content = self.fetcher(key)
        fetched = self.now()
        digest = hashlib.sha256(content).hexdigest()
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        # Content-addressed storage contains public evidence only, never secrets.
        (self.cache_dir / f"{digest}.raw").write_bytes(content)
        with self._lock:
            if len(self._cache) >= 128:
                self._cache.pop(next(iter(self._cache)))
            self._cache[key] = (time.monotonic(), content, fetched)
        return content, fetched, "fetched"

    def _source(self, source):
        evidence = SourceEvidence(source_id=source["id"], name=source["name"], kind=source["kind"],
                                  url=source["url"], status="unavailable")
        try:
            raw, fetched, status = self._get(source)
            evidence.status, evidence.fetched_at = status, fetched
            evidence.sha256 = hashlib.sha256(raw).hexdigest()
            return evidence, raw
        except Exception as error:
            # Do not leak request headers, credentials, or arbitrary remote error bodies.
            evidence.detail = f"Không lấy được dữ liệu ({type(error).__name__}); không dùng số giả thay thế."
            return evidence, None

    def collect(self, payload):
        if os.getenv("MARKET_LEGACY_COLLECTION_DISABLED") == "1":
            # The old preview collector has no persistent robots/rate-limit
            # ledger. It must not bypass the governed v1 source decisions.
            return {"region": "VN-DN", "location": "Đà Nẵng", "coordinates": [16.0544, 108.2022],
                    "collected_at": self.now().isoformat(), "weather": None, "sources": [],
                    "documents": [], "comparable_rates": [], "rejected_rates": 0,
                    "collection_status": "disabled_pending_governed_jobs"}
        query = urlencode({"latitude": 16.0544, "longitude": 108.2022,
            "daily": "temperature_2m_max,precipitation_probability_max,wind_speed_10m_max",
            "timezone": "Asia/Ho_Chi_Minh", "forecast_days": 16})
        weather_source = {"id": "open-meteo-danang", "name": "Open-Meteo · Đà Nẵng",
                          "kind": "weather", "url": f"https://api.open-meteo.com/v1/forecast?{query}"}
        sources = []
        for configured in self.sources:
            source = dict(configured)
            if source["kind"] == "rates_json":
                parsed = urlparse(source["url"])
                params = dict(parse_qsl(parsed.query)) | {"check_in_date": payload.check_in_date.isoformat(),
                    "nights": "1", "guest_count": str(payload.guest_count), "region": "VN-DN",
                    "room_segment": payload.room_segment, "currency": "VND"}
                source["url"] = urlunparse(parsed._replace(query=urlencode(params)))
            sources.append(source)
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(self._source, [weather_source, *sources]))
        evidence, documents, rates, weather = [], [], [], None
        rejected_rates = 0
        for item, raw in results:
            evidence.append(item)
            if raw is None:
                continue
            try:
                if item.kind == "weather":
                    daily = json.loads(raw)["daily"]
                    target = payload.check_in_date.isoformat()
                    if target not in daily["time"]:
                        item.status = "out_of_horizon"
                        item.detail = "Ngày lưu trú nằm ngoài dữ liệu dự báo được nguồn trả về."
                        continue
                    i = daily["time"].index(target)
                    weather = {"date": target, "temperature_max_c": daily["temperature_2m_max"][i],
                        "rain_probability_pct": daily["precipitation_probability_max"][i],
                        "wind_max_kmh": daily["wind_speed_10m_max"][i], "source_id": item.source_id}
                    values = (weather["temperature_max_c"], weather["rain_probability_pct"], weather["wind_max_kmh"])
                    if not all(isinstance(v, (float, int)) and not isinstance(v, bool) for v in values):
                        raise ValueError("Missing forecast values")
                    if not (-90 <= values[0] <= 65 and 0 <= values[1] <= 100 and 0 <= values[2] <= 500):
                        raise ValueError("Invalid forecast units/range")
                elif item.kind == "rates_json":
                    for row in json.loads(raw)["quotes"][:200]:
                        try:
                            quote = ComparableRate.model_validate(row)
                            age = (self.now() - quote.observed_at).total_seconds()
                            public_https(quote.source_url)
                            if not (0 <= age <= 3600 and quote.check_in_date == payload.check_in_date
                                    and quote.guest_count == payload.guest_count and quote.room_segment == payload.room_segment):
                                raise ValueError("Stale or incomparable quote")
                            rates.append(quote.model_dump(mode="json") | {"source_id": item.source_id})
                        except Exception:
                            rejected_rates += 1
                    item.detail = "Chỉ nhận báo giá VND/1 đêm, cùng ngày/khách/phân khúc, ăn sáng, hoàn hủy và gồm thuế."
                else:
                    parser = PageText()
                    parser.feed(raw.decode("utf8", errors="replace"))
                    document = parser.text()[:18000]
                    documents.append({"source_id": item.source_id, "kind": item.kind, "text": document})
                    item.detail = ("Tài liệu sự kiện công khai; ngày và địa điểm cần được model trích xuất và kiểm tra dẫn chứng."
                                   if item.kind == "events" else
                                   "Trang công khai đã tải; nội dung khuyến mại không phải báo giá phòng theo ngày.")
            except Exception:
                item.status = "unavailable"
                item.detail = "Đã nhận phản hồi nhưng dữ liệu không đúng hợp đồng nguồn."
                if item.kind == "weather":
                    weather = None
        # One hotel, one contribution to peer distribution; keep freshest quote.
        unique = {}
        for rate in sorted(rates, key=lambda r: r["observed_at"]):
            unique[rate["hotel_id"]] = rate
        return {"region": "VN-DN", "location": "Đà Nẵng", "coordinates": [16.0544, 108.2022],
                "collected_at": self.now().isoformat(), "weather": weather,
                "sources": [s.model_dump(mode="json") for s in evidence],
                "documents": documents, "comparable_rates": list(unique.values()), "rejected_rates": rejected_rates}
