"""Optimizer software checks with explicit fixtures; not market accuracy evidence."""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.core.stay_market_contract import StayCore, CoreNight
from app.services.stay_price_optimizer import FACTORS, optimize_stay, round_nightly_vnd, BusinessConfigurationError


def core(prices=('1000000', '1250000'), floor='800000', ceiling='1600000', cost='400000'):
    start = date(2026, 12, 31)
    return StayCore(origin='backend_inventory_policy', room_type_id=1, capacity=2, guests=2,
                    check_in=start, check_out=start + timedelta(days=len(prices)), policy_version='test_fixture',
                    nights=tuple(CoreNight(night=start + timedelta(days=i), available_rooms=1,
                        policy_price=Decimal(p), floor=Decimal(floor), ceiling=Decimal(ceiling), variable_cost=Decimal(cost))
                        for i, p in enumerate(prices)))


class Fixture:
    kind = 'test_fixture'
    version = 'test_fixture_optimizer_v1'
    def __init__(self): self.predictions = []
    def in_domain(self, stay, prices): return all(Decimal('900000') <= p <= Decimal('1500000') for p in prices)
    def predict_acceptance(self, stay, prices):
        self.predictions.append(prices)
        return .8 if sum(prices) <= 2400000 else .1


def test_nightly_constraints_rounding_total_and_fixture_maximum():
    model = Fixture()
    result = optimize_stay(core(), model, model_ready=True, coverage_ready=True, mode='lab')
    assert len(FACTORS) == 101 and Decimal('1.00') in FACTORS
    assert FACTORS[0] == Decimal('.8') and FACTORS[-1] == Decimal('1.3')
    eligible = [c for c in result['candidates'] if c['status'] == 'eligible']
    for candidate in eligible:
        assert candidate['total'] == sum(candidate['nightly_prices'])
        assert all(800000 <= p <= 1600000 and p % 1000 == 0 for p in candidate['nightly_prices'])
    assert result['proposed_total'] == sum(result['proposed_nightly_prices'])
    selected = next(c for c in eligible if c['factor'] == result['chosen_factor'])
    assert Decimal(selected['expected_contribution']) == max(Decimal(c['expected_contribution']) for c in eligible)
    assert result['displayed_total'] == 2250000
    assert result['effective_source'] == 'lab_test_fixture' and 'MÔ HÌNH GIẢ' in result['label']


def test_policy_outside_domain_never_attaches_or_queries_probability():
    model = Fixture()
    result = optimize_stay(core(prices=('850000',)), model, model_ready=True, coverage_ready=True, mode='lab')
    assert result['reason'] == 'policy_outside_model_domain'
    assert result['probability_at_displayed_price'] is None and result['probability_at_proposed_price'] is None
    assert result['proposed_total'] is None and model.predictions == []


@pytest.mark.parametrize('price,rounded', [('1000499.99', 1000000), ('1000500', 1001000), ('1000500.01', 1001000)])
def test_half_up_vnd_boundary(price, rounded):
    assert round_nightly_vnd(Decimal(price)) == rounded


def test_floor_applied_after_rounding_and_invalid_policy_rejected():
    with pytest.raises(BusinessConfigurationError):
        optimize_stay(core(prices=('1000499',), floor='1000100'), None)
    with pytest.raises(ValueError):
        core(prices=('1000000',), floor='1100000', ceiling='900000')


def test_fixture_is_rejected_from_operational_path():
    with pytest.raises(ValueError, match='Fixture'):
        optimize_stay(core(), Fixture(), coverage_ready=True, model_ready=True)


def test_missing_gate_does_not_call_model_and_ties_prefer_policy():
    model = Fixture()
    result = optimize_stay(core(), model, coverage_ready=True, mode='lab')
    assert result['reason'] == 'conversion_not_ready' and model.predictions == []
    model.predict_acceptance = lambda stay, prices: 0
    result = optimize_stay(core(), model, coverage_ready=True, model_ready=True, mode='lab')
    assert Decimal(result['chosen_factor']) == 1


@pytest.mark.parametrize('bad', [float('nan'), float('inf'), -.1, 1.1])
def test_model_error_discards_partial_scores(bad):
    model = Fixture()
    model.predict_acceptance = lambda stay, prices: bad
    result = optimize_stay(core(), model, coverage_ready=True, model_ready=True, mode='lab')
    assert result['reason'] == 'model_error' and result['candidates'] == []
    assert result['proposed_total'] is None and result['probability_at_displayed_price'] is None
