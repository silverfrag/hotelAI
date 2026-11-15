"""Tree-based local explanation engine for AI pricing models.

Implements the Saabas Tree Interpreter algorithm for Random Forest models.
Unlike heuristic feature importance or arbitrary perturbation, this method
decomposes the exact decision path of every tree:
    prediction(x) - baseline = sum_i(phi_i)

This satisfies efficiency, local accuracy, and is mathematically exact
to machine precision (residual < 1e-6).
"""
from __future__ import annotations

import warnings
from typing import Any
import numpy as np
import pandas as pd

from app.schemas.pricing_schema import FeatureAttribution, PriceExplanation

DEMAND_FEATURE_NAMES = {
    "occupancy_ratio",
    "booking_velocity_score",
    "demand_pressure_score",
    "availability_tightness",
    "price_vs_market_ratio",
}

FEATURE_HUMAN_LABELS: dict[str, str] = {
    "lead_time": "Thời gian đặt trước (Lead time)",
    "arrival_month_sin": "Tính chu kỳ mùa vụ (Tháng sin)",
    "arrival_month_cos": "Tính chu kỳ mùa vụ (Tháng cos)",
    "arrival_weekday_sin": "Tính chu kỳ ngày trong tuần (Thứ sin)",
    "arrival_weekday_cos": "Tính chu kỳ ngày trong tuần (Thứ cos)",
    "stay_nights": "Số đêm lưu trú",
    "weekend_nights": "Số đêm cuối tuần",
    "weekend_share": "Tỷ trọng cuối tuần trong kỳ nghỉ",
    "guest_count": "Số lượng khách lưu trú",
    "occupancy_ratio": "Tỷ lệ lấp đầy phòng (Occupancy)",
    "booking_velocity_score": "Tốc độ đặt phòng 7 ngày (Velocity)",
    "demand_pressure_score": "Áp lực nhu cầu thị trường (Demand pressure)",
    "availability_tightness": "Mức độ khan hiếm phòng (Tightness)",
    "price_vs_market_ratio": "Tỷ lệ giá so với giá trung bình thị trường",
}


def _interpret_feature(name: str, value: Any, attribution: float) -> str:
    """Generate human-readable Vietnamese interpretation for a feature."""
    direction = "tăng" if attribution > 0.005 else ("giảm" if attribution < -0.005 else "ổn định")
    pct_str = f"{abs(attribution) * 100:.1f}%"

    if name == "lead_time":
        days = int(value)
        if days <= 3:
            return f"Đặt cận ngày ({days} ngày) làm {direction} hệ số giá ~{pct_str}"
        return f"Đặt trước {days} ngày giúp {direction} giá ~{pct_str}"
    if name in {"weekend_nights", "weekend_share"}:
        return f"Kỳ nghỉ có yếu tố cuối tuần làm {direction} giá ~{pct_str}"
    if name == "guest_count":
        return f"Số lượng {value} khách làm {direction} giá ~{pct_str}"
    if name == "occupancy_ratio":
        occ_pct = float(value) * 100
        return f"Công suất phòng đang ở mức {occ_pct:.0f}%, làm {direction} giá ~{pct_str}"
    if name in {"arrival_month_sin", "arrival_month_cos"}:
        return f"Yếu tố mùa vụ du lịch làm {direction} giá ~{pct_str}"
    if name in {"arrival_weekday_sin", "arrival_weekday_cos"}:
        return f"Thời điểm nhận phòng trong tuần làm {direction} giá ~{pct_str}"

    return f"Đặc trưng {FEATURE_HUMAN_LABELS.get(name, name)} làm {direction} giá ~{pct_str}"


def explain_random_forest(
    model: Any,
    feature_frame: pd.DataFrame,
    features_dict: dict[str, Any],
) -> PriceExplanation:
    """Decompose Random Forest prediction into exact local feature attributions."""
    if not hasattr(model, "estimators_"):
        raise ValueError("Model does not expose tree estimators for path interpretation.")

    cols = list(feature_frame.columns)
    x = feature_frame.values

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        prediction = float(model.predict(feature_frame)[0])

    contributions = np.zeros(len(cols), dtype=float)
    root_values = []
    n_estimators = len(model.estimators_)

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for dt in model.estimators_:
            tree = dt.tree_
            node_indicator = dt.decision_path(x)
            node_indices = node_indicator.indices
            root_values.append(float(tree.value[0, 0, 0]))
            for i in range(len(node_indices) - 1):
                curr_node = node_indices[i]
                next_node = node_indices[i + 1]
                feature_idx = tree.feature[curr_node]
                delta = float(tree.value[next_node, 0, 0] - tree.value[curr_node, 0, 0])
                contributions[feature_idx] += delta / n_estimators

    baseline = float(np.mean(root_values))
    sum_contributions = float(np.sum(contributions))
    residual = abs(prediction - (baseline + sum_contributions))
    if residual > 1e-4:
        raise ValueError(f"Tree explanation residual {residual:.6f} exceeds tolerance.")

    # Calculate absolute contributions for percentage breakdown
    total_abs = float(np.sum(np.abs(contributions)))
    if total_abs == 0.0:
        total_abs = 1.0

    attributions: list[FeatureAttribution] = []
    demand_abs_sum = 0.0
    temporal_abs_sum = 0.0

    for name, attr_val in zip(cols, contributions):
        attr_float = round(float(attr_val), 4)
        pct_contrib = round(abs(attr_val) / total_abs * 100.0, 1)
        val = features_dict.get(name, 0.0)
        category = "demand" if name in DEMAND_FEATURE_NAMES else "temporal"

        if category == "demand":
            demand_abs_sum += abs(attr_val)
        else:
            temporal_abs_sum += abs(attr_val)

        attributions.append(
            FeatureAttribution(
                feature=name,
                value=val,
                attribution=attr_float,
                pct_contribution=pct_contrib,
                category=category,
                human_label=FEATURE_HUMAN_LABELS.get(name, name),
                interpretation=_interpret_feature(name, val, attr_float),
            )
        )

    # Sort attributions by absolute impact
    attributions.sort(key=lambda a: abs(a.attribution), reverse=True)

    demand_share_pct = round(demand_abs_sum / total_abs * 100.0, 1)
    temporal_share_pct = round(temporal_abs_sum / total_abs * 100.0, 1)

    top_feature = attributions[0]
    primary_driver = (
        f"{top_feature.human_label} là yếu tố ảnh hưởng lớn nhất "
        f"({top_feature.attribution:+.3f}, chiếm {top_feature.pct_contribution}% tác động)"
    )

    # Counterfactual computation using actual model evaluation on perturbed lead_time
    lead_time_val = int(features_dict.get("lead_time", 14))
    cf_lead_time = 2 if lead_time_val > 7 else lead_time_val + 14
    cf_frame = feature_frame.copy()
    if "lead_time" in cf_frame.columns:
        cf_frame["lead_time"] = cf_lead_time
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        cf_prediction = float(model.predict(cf_frame)[0])
    cf_delta_pct = ((cf_prediction - prediction) / max(0.01, abs(prediction))) * 100.0
    action_label = "đặt cận ngày" if lead_time_val > 7 else "đặt phòng sớm hơn"
    counterfactual = (
        f"Nếu cùng ngày lưu trú nhưng {action_label} (lead time = {cf_lead_time} ngày thay vì {lead_time_val} ngày), "
        f"mô hình Random Forest dự báo hệ số ×{cf_prediction:.3f} ({cf_delta_pct:+.1f}% so với ×{prediction:.3f})."
    )

    return PriceExplanation(
        primary_driver=primary_driver,
        demand_share_pct=demand_share_pct,
        temporal_share_pct=temporal_share_pct,
        attributions=attributions,
        counterfactual=counterfactual,
        ai_vs_script_note=(
            "Giải thích giá dựa trên giải thuật phân rã đường đi quyết định "
            "(Saabas Tree Interpreter) trên mô hình Random Forest thực tế. "
            "Tổng các đóng góp bằng chính xác sai lệch giữa giá dự báo và giá nền baseline."
        ),
    )
