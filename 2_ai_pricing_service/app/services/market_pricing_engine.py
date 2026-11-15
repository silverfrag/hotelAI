"""Evidence -> grounded context -> learned probability -> constrained shadow price.

The public simulator never writes a checkout quote. A historical ADR model can
be shown as a separately labelled benchmark, never substituted for conversion.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from app.core.config import DEFAULT_MODEL_PATH
from app.core.market_feature_contract import FEATURES, VERSION, context_features
from app.schemas.pricing_schema import PricingRequest
from app.services.inference import PricingInferenceService
from app.services.market_context import CONTEXT_VERSION, GroundedContextAnalyzer
from app.services.market_evidence import EvidenceCollector, utc_now


class MarketResponseModel:
    def __init__(self, path=None):
        self.path = Path(path or os.getenv("MARKET_CONVERSION_MODEL_DIR", "app/models/danang_market_v1"))
        self.model, self.metadata = None, None
        self.reason = "Chưa có mô hình conversion Đà Nẵng vượt kiểm định dữ liệu quan sát."
        self._load()

    def _load(self):
        try:
            manifest = json.loads((self.path / "manifest.json").read_text(encoding="utf8"))
            for name in ("model.joblib", "report.json"):
                if hashlib.sha256((self.path / name).read_bytes()).hexdigest() != manifest[name]:
                    raise ValueError("Checksum mismatch")
            artifact = joblib.load(self.path / "model.joblib")
            metadata = artifact["metadata"]
            if metadata != json.loads((self.path / "report.json").read_text(encoding="utf8")):
                raise ValueError("Artifact/report mismatch")
            if (metadata["feature_contract_version"] != VERSION or metadata["features"] != list(FEATURES)
                or metadata["region"] != "VN-DN" or metadata["lifecycle"] != "shadow_only"
                or metadata["context_version"] != CONTEXT_VERSION
                or metadata["provenance"] != "reviewed_observed_exposures"
                or metadata["evaluation"]["passes_gate"] is not True
                or list(artifact["model"].feature_names_in_) != list(FEATURES)):
                raise ValueError("Unapproved model contract")
            self.model, self.metadata = artifact["model"], metadata
        except FileNotFoundError:
            pass
        except Exception:
            self.reason = "Artifact không vượt kiểm tra checksum, nguồn dữ liệu hoặc hợp đồng mô hình."

    def score(self, features, prices, base_price):
        frame = pd.DataFrame([{**features, "offered_price_ratio": p / base_price} for p in prices], columns=FEATURES)
        probabilities = self.model.predict_proba(frame)[:, 1]
        if (not np.isfinite(probabilities).all() or (probabilities < 0).any() or (probabilities > 1).any()
            or (np.diff(probabilities) > 1e-8).any()):
            raise ValueError("Invalid/nonmonotone probability curve")
        return probabilities

    def contributions(self, features, price, base):
        frame = pd.DataFrame([{**features, "offered_price_ratio": price / base}], columns=FEATURES)
        scaled = self.model[0].transform(frame)[0]
        weights = self.model[-1].coef_[0]
        return sorted([{"feature": name, "value": float(frame.iloc[0][name]),
                        "log_odds_contribution": float(x * w)} for name, x, w in zip(FEATURES, scaled, weights)],
                      key=lambda item: abs(item["log_odds_contribution"]), reverse=True)


def compute_weather_index(weather: dict | None) -> dict | None:
    """Compute a transparent meteorological comfort & storm-risk index (advisory only)."""
    if not isinstance(weather, dict):
        return None
    temp = weather.get("temperature_max_c")
    rain = weather.get("rain_probability_pct")
    wind = weather.get("wind_max_kmh")
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (temp, rain, wind)):
        return None
    temp_penalty = min(30.0, max(0.0, abs(float(temp) - 27.0) * 2.2))
    rain_penalty = min(50.0, max(0.0, float(rain) * 0.50))
    wind_penalty = min(35.0, max(0.0, (float(wind) - 15.0) * 0.90))
    comfort_score = round(max(0.0, min(100.0, 100.0 - temp_penalty - rain_penalty - wind_penalty)), 1)
    if rain >= 70 or wind >= 40 or comfort_score < 40:
        storm_risk = "high"
    elif rain >= 40 or wind >= 25 or comfort_score < 68:
        storm_risk = "moderate"
    else:
        storm_risk = "low"
    recommended_weather = "stormy_unfavorable" if (storm_risk == "high" or rain >= 55) else "sunny_favorable"
    return {
        "comfort_score_0_100": comfort_score,
        "storm_risk_level": storm_risk,
        "recommended_weather_signal": recommended_weather,
        "temperature_max_c": float(temp),
        "rain_probability_pct": float(rain),
        "wind_max_kmh": float(wind),
        "provenance": "METEOROLOGY_INDEX_ADVISORY",
        "formula_note": (
            "Chỉ số định lượng (0–100) tính từ nhiệt độ tối đa (tối ưu 27°C), "
            "xác suất mưa (%) và gió giật (km/h) từ Open-Meteo Đà Nẵng."
        ),
    }


def build_scenario_sync_suggestion(weather_index: dict | None, analysis: dict) -> dict:
    """Suggest [C] simulator scenario presets from verified Open-Meteo & NLP evidence."""
    active_events = analysis.get("events", [])
    active_facts = analysis.get("facts", [])
    all_facts = analysis.get("all_extracted_facts", active_facts)
    storm_high = bool(weather_index and weather_index["storm_risk_level"] == "high")

    if len(active_events) > 0:
        demand_level = "high"
        preset = "holiday_surge"
    elif storm_high:
        demand_level = "low"
        preset = "monsoon_low"
    else:
        demand_level = "normal"
        preset = "standard"

    parts: list[str] = []
    if weather_index:
        parts.append(
            f"Open-Meteo Đà Nẵng đạt điểm thuận lợi {weather_index['comfort_score_0_100']}/100 "
            f"(rủi ro mưa bão: {weather_index['storm_risk_level']})."
        )
    else:
        parts.append("Ngày check-in nằm ngoài cửa sổ 16 ngày của Open-Meteo.")
    if active_events:
        parts.append(f"Phát hiện {len(active_events)} sự kiện Đà Nẵng trùng ngày lưu trú.")
    elif all_facts:
        parts.append(
            f"Trích xuất được {len(all_facts)} sự kiện/ưu đãi có ngày rõ ràng tại Đà Nẵng (không trùng ngày check-in đang chọn)."
        )
    parts.append("Chỉ dùng để điền nhanh giả định [C] trên Simulator khi admin bấm Áp dụng; không sửa ML [A].")

    return {
        "weather": weather_index["recommended_weather_signal"] if weather_index else None,
        "demand_level": demand_level,
        "suggested_scenario_preset": preset,
        "active_event_count": len(active_events),
        "total_extracted_facts": len(all_facts),
        "provenance": "SIMULATED_ASSUMPTION_SUGGESTION",
        "reason_vi": " ".join(parts),
    }


class MarketPricingEngine:
    def __init__(self, *, collector=None, analyzer=None, model=None, reference=None, decision_dir=None, now=utc_now):
        self.collector = collector or EvidenceCollector()
        self.analyzer = analyzer or GroundedContextAnalyzer()
        self.model = model or MarketResponseModel()
        self.reference = reference
        self.decision_dir = Path(decision_dir or os.getenv("MARKET_DECISIONS_DIR", ".tmp/market-decisions"))
        self.now = now

    def _reference(self, request, today):
        try:
            if self.reference is None:
                self.reference = PricingInferenceService(DEFAULT_MODEL_PATH)
                self.reference.load()
            prediction = self.reference.predict(PricingRequest(
                lead_time=max(0, (request.check_in_date - today).days), check_in_date=request.check_in_date,
                check_out_date=request.check_in_date + timedelta(days=1), guest_count=request.guest_count))
            return {"status": "available", "price_vnd": round(request.base_price * prediction.multiplier),
                    "model_version": prediction.model_version, "training_run_id": prediction.training_run_id,
                    "scope": "Benchmark ADR lịch sử Bồ Đào Nha; chưa kiểm chứng chuyển miền Đà Nẵng, không phải giá chốt deal."}
        except Exception:
            return {"status": "unavailable", "price_vnd": None,
                    "scope": "Không có mô hình tham chiếu sẵn sàng; không thay bằng hệ số giả."}

    def decide(self, request):
        now = self.now()
        # Business date is fixed UTC+7, independent of the execution host.
        today = (now + timedelta(hours=7)).date()
        evidence = self.collector.collect(request)
        analysis = self.analyzer.analyze(evidence, request.check_in_date)
        blockers = []
        if analysis["status"] in {"analyzing", "busy"}:
            blockers.append("Model local đang đọc tài liệu; chờ hoàn tất trước khi đề xuất giá.")
        if request.check_in_date < today:
            blockers.append("Ngày lưu trú đã qua; không dựng lại ngữ cảnh lịch sử bằng dữ liệu hôm nay.")
        if request.rooms_available == 0:
            blockers.append("Hết phòng; không đề xuất giá bán.")
        # P is the guest's tax-inclusive nightly price. Commission is on gross P.
        net_factor = 1 / (1 + request.tax_pct) - request.commission_pct
        lower = math.ceil(max(request.floor_price, (request.serving_cost + request.min_margin) / net_factor) / 1000) * 1000
        upper = math.floor(request.ceiling_price / 1000) * 1000
        if lower > upper:
            blockers.append("Giá sàn bảo vệ biên đóng góp vượt giá trần; không có phương án khả thi.")
        features = None
        try:
            features = context_features(request, evidence, analysis, today)
        except ValueError:
            if evidence["weather"] is None:
                blockers.append("Chưa có dự báo thời tiết phù hợp cho ngày lưu trú.")
            if len(evidence["comparable_rates"]) < 2:
                blockers.append("Cần ít nhất 2 báo giá đối thủ cùng điều kiện lưu trú để so sánh.")
        if self.model.model is None:
            blockers.append(self.model.reason)
        else:
            if self.model.metadata.get("context_model") != analysis["model"]:
                blockers.append("Model trích xuất ngữ cảnh khác với phiên bản dùng khi huấn luyện conversion.")
            if features:
                outside = [key for key, value in features.items()
                           if not self.model.metadata["domain"][key]["min"] - 1e-8 <= value <= self.model.metadata["domain"][key]["max"] + 1e-8]
                if outside:
                    blockers.append("Ngữ cảnh ngoài miền dữ liệu đã học: " + ", ".join(outside))
                support = self.model.metadata["domain"]["offered_price_ratio"]
                lower = max(lower, math.ceil(support["min"] * request.base_price / 1000) * 1000)
                upper = min(upper, math.floor(support["max"] * request.base_price / 1000) * 1000)
                if lower > upper:
                    blockers.append("Khoảng giá chính sách không giao với khoảng giá đã quan sát khi học.")
        curve, selected, contributions = [], None, []
        if not blockers:
            prices = sorted({int(round(v / 1000) * 1000) for v in np.linspace(lower, upper, min(101, int((upper - lower) / 1000) + 1))})
            try:
                probabilities = self.model.score(features, prices, request.base_price)
                curve = [{"price_vnd": p, "conversion_probability": float(q),
                          "expected_contribution_vnd": float((p * net_factor - request.serving_cost) * q)}
                         for p, q in zip(prices, probabilities)]
                selected = max(curve, key=lambda point: (point["expected_contribution_vnd"], -abs(point["price_vnd"] - request.base_price)))
                contributions = self.model.contributions(features, selected["price_vnd"], request.base_price)
            except Exception:
                blockers.append("Suy luận conversion không hợp lệ; đã dừng đề xuất giá.")
                curve, selected = [], None
        weather_index = compute_weather_index(evidence.get("weather"))
        scenario_sync = build_scenario_sync_suggestion(weather_index, analysis)
        result = {"region": "VN-DN", "location": "Đà Nẵng", "created_at": now.isoformat(),
            "feature_contract_version": VERSION, "status": "shadow_ready" if selected else "insufficient_evidence",
            "inventory_provenance": "user_input", "advisory_only": True, "request": request.model_dump(mode="json"),
            "evidence": {k: v for k, v in evidence.items() if k != "documents"}, "context": analysis,
            "weather_index": weather_index, "scenario_sync_suggestion": scenario_sync,
            "features": features, "blockers": blockers, "reference": self._reference(request, today),
            "model": {"ready": self.model.model is not None, "metadata": self.model.metadata},
            "policy": {"floor_vnd": lower, "ceiling_vnd": upper, "rounding_vnd": 1000,
                       "commission_pct": request.commission_pct, "tax_pct": request.tax_pct, "serving_cost": request.serving_cost},
            "curve": curve, "selected": selected, "contributions": contributions,
            "objective": "Expected contribution per exposed one-night quote; discrete candidate search.",
            "limitations": ["Tồn phòng và chi phí do người dùng nhập cho kịch bản; chưa xác nhận từ PMS.",
                "Dự đoán từ dữ liệu quan sát không chứng minh tác động nhân quả khi thay đổi giá.",
                "Không tự áp dụng vào checkout. Trang khuyến mại công khai không thay thế báo giá theo ngày.",
                "Sự kiện được trích xuất không tự tạo ra phần trăm tăng giá; tác động phải được mô hình học."]}
        raw = json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False).encode("utf8")
        digest = hashlib.sha256(raw).hexdigest()
        self.decision_dir.mkdir(parents=True, exist_ok=True)
        (self.decision_dir / f"{digest}.json").write_bytes(raw)
        return result | {"decision_id": digest}
