from datetime import date, datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from app.core.stay_market_contract import CoverageEvidence, StayCore, StayFeatureContract, assess_stay_context as _assess


def assess_stay_context(*args, **kwargs):
    # Most unit cases exercise the full variant independently of deployment choice.
    kwargs.setdefault("contract", StayFeatureContract())
    return _assess(*args, **kwargs)

NOW = datetime(2026, 11, 7, 12, tzinfo=timezone.utc)


def core(days=7, available=1):
    start = date(2026, 11, 10)
    return StayCore(origin="backend_inventory_policy", room_type_id=8, capacity=6, guests=2,
                    check_in=start, check_out=start + timedelta(days=days), policy_version="fixture-policy",
                    nights=[dict(night=start + timedelta(days=i), available_rooms=available,
                                 policy_price=1000000, floor=800000, ceiling=1300000, variable_cost=400000)
                            for i in range(days)])


def observation(group, days, **changes):
    return CoverageEvidence(source_id="test_fixture", group=group, geography="VN-DN", observed_at=NOW,
                            covered_nights=days, validated=True,
                            coverage_basis={"weather": "daily_forecast", "events": "declared_source_window",
                                            "competitors": "whole_stay_comparable_rate"}[group], **changes)


def complete_evidence(stay):
    nights = {night.night for night in stay.nights}
    return [observation("weather", nights), observation("events", nights),
            observation("competitors", nights, hotel_id="a"), observation("competitors", nights, hotel_id="b")]


def test_complete_context_only_enables_shadow_never_guest_ai_price():
    stay = core()
    result = assess_stay_context(stay, complete_evidence(stay), now=NOW, model_ready=True)
    assert result["shadow_eligible"] and result["context_eligible_for_training"]
    assert result["price_source"] == "policy" and result["conversion_probability"] is None


@pytest.mark.parametrize("count,eligible", [(6, True), (5, False)])
def test_weather_coverage_threshold_uses_whole_stay(count, eligible):
    stay = core()
    observations = complete_evidence(stay)
    observations[0] = observation("weather", {night.night for night in stay.nights[:count]})
    result = assess_stay_context(stay, observations, now=NOW, model_ready=True)
    assert result["shadow_eligible"] is eligible
    assert result["coverage"]["weather"]["missing_value"] is None
    assert sum(result["coverage"]["weather"]["missing_mask"]) == 7 - count


def test_partial_competitor_quotes_cannot_be_stitched_or_duplicate_hotel_counted_twice():
    stay = core()
    nights = [night.night for night in stay.nights]
    evidence = [observation("competitors", nights[:4], hotel_id="a"),
                observation("competitors", nights[4:], hotel_id="b"),
                observation("competitors", nights, hotel_id="c"),
                observation("competitors", nights, hotel_id="c")]
    result = assess_stay_context(stay, evidence, now=NOW, model_ready=True)
    assert result["coverage"]["competitors"]["covered_nights"] == 0
    assert not result["shadow_eligible"]


@pytest.mark.parametrize("change,reason", [
    ({"observed_at": NOW - timedelta(hours=6, microseconds=1)}, "stale_or_future_observation"),
    ({"observed_at": NOW + timedelta(seconds=1)}, "stale_or_future_observation"),
    ({"provenance": "replay"}, "replay_excluded_from_live_features"),
])
def test_stale_future_and_replay_do_not_become_live_coverage(change, reason):
    stay = core()
    evidence = complete_evidence(stay)
    evidence[0] = evidence[0].model_copy(update=change)
    result = assess_stay_context(stay, evidence, now=NOW)
    assert reason in result["coverage"]["weather"]["rejection_reasons"]
    assert not result["context_eligible_for_training"]


def test_llm_not_approved_cannot_supply_event_features():
    stay = core()
    evidence = complete_evidence(stay)
    evidence[1] = evidence[1].model_copy(update={"extraction_kind": "llm"})
    result = assess_stay_context(stay, evidence, now=NOW, model_ready=True)
    assert "llm_gate_not_passed" in result["coverage"]["events"]["rejection_reasons"]
    assert not result["shadow_eligible"]


def test_missing_core_rejected_and_unavailable_inventory_never_fabricates_quote():
    stay = core()
    with pytest.raises(ValidationError, match="every stay night"):
        StayCore.model_validate(stay.model_dump() | {"nights": stay.nights[:-1]})
    unavailable = core(available=0)
    assert assess_stay_context(unavailable, [], now=NOW)["price_source"] == "no_quote"


def test_disable_requires_approval_and_distinct_version():
    with pytest.raises(ValidationError):
        StayFeatureContract(disabled_groups={"competitors": ""}, version="different")
    with pytest.raises(ValidationError):
        StayFeatureContract(disabled_groups={"competitors": "test_fixture_approval"})
    contract = StayFeatureContract(version="test_fixture_without_competitors", disabled_groups={"competitors": "test_fixture_approval"})
    stay = core()
    evidence = complete_evidence(stay)[:2]
    assert assess_stay_context(stay, evidence, now=NOW, contract=contract, model_ready=True)["shadow_eligible"]


def test_deployment_variant_excludes_competitor_group_without_neutral_imputation():
    stay = core()
    result = _assess(stay, complete_evidence(stay)[:2], now=NOW, model_ready=True)
    assert result["contract_version"] == "stay-market-v1-no-competitors"
    assert result["coverage"]["competitors"]["status"] == "disabled_by_approved_branch"
    assert "coverage_ratio" not in result["coverage"]["competitors"]
    assert result["shadow_eligible"]
