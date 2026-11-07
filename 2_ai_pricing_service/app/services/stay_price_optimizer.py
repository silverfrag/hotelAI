"""Pure, nightly shadow optimizer. No collection, model promotion or quote issuance.

The backend is authoritative for policy/core. A fixture can run only in lab mode;
none of the results here can change the guest's displayed policy price in v1.
"""
from decimal import Decimal, ROUND_HALF_UP
import math
from typing import Protocol

from app.core.stay_market_contract import StayCore

ROUNDING_VND = Decimal('1000')
FACTORS = tuple(Decimal('0.800') + Decimal('0.005') * i for i in range(101))


class BusinessConfigurationError(ValueError):
    pass


class StayModel(Protocol):
    kind: str  # operational_shadow or test_fixture; registry controls actual readiness
    version: str

    def in_domain(self, core: StayCore, prices: tuple[Decimal, ...]) -> bool: ...

    def predict_acceptance(self, core: StayCore, prices: tuple[Decimal, ...]) -> float: ...


def round_nightly_vnd(value: Decimal) -> Decimal:
    return (value / ROUNDING_VND).quantize(Decimal('1'), rounding=ROUND_HALF_UP) * ROUNDING_VND


def optimize_stay(core: StayCore, model: StayModel | None, *, model_ready=False,
                  coverage_ready=False, mode='shadow'):
    if mode not in ('shadow', 'lab'):
        raise ValueError('Only shadow or explicitly labelled lab is permitted in v1')
    if model is not None and (model.kind not in ('operational_shadow', 'test_fixture')
                              or (model.kind == 'test_fixture' and mode != 'lab')):
        raise ValueError('Fixture/unrecognized model cannot enter operational shadow')
    nights = tuple(sorted(core.nights, key=lambda night: night.night))
    policy = tuple(round_nightly_vnd(night.policy_price) for night in nights)
    def valid(prices):
        return all(night.floor <= price <= night.ceiling and price >= night.variable_cost
                   for night, price in zip(nights, prices))
    if not valid(policy):
        raise BusinessConfigurationError('Rounded backend policy violates nightly business constraints')
    if any(night.available_rooms == 0 for night in nights):
        raise BusinessConfigurationError('No room availability for the whole stay; do not issue a quote')
    result = {'mode': mode, 'effective_source': 'policy', 'displayed_nightly_prices': [int(p) for p in policy],
              'displayed_total': int(sum(policy)), 'rounding_vnd': int(ROUNDING_VND),
              'policy_version': core.policy_version, 'model_version': None,
              'probability_at_displayed_price': None, 'probability_at_proposed_price': None,
              'proposed_nightly_prices': None, 'proposed_total': None, 'chosen_factor': None,
              'candidate_count_initial': len(FACTORS), 'candidates': [], 'reason': None}
    if mode == 'lab':
        if model is None or model.kind != 'test_fixture':
            raise ValueError('Lab requires an explicit test_fixture model')
        result['label'] = 'MÔ HÌNH GIẢ KIỂM THỬ — KHÔNG PHẢI DỰ BÁO THỊ TRƯỜNG'
    if not coverage_ready or not model_ready or model is None:
        return result | {'reason': 'coverage_not_ready' if not coverage_ready else 'conversion_not_ready'}
    try:
        # This is a mandatory gate, checked before querying any probability.
        if not model.in_domain(core, policy):
            return result | {'reason': 'policy_outside_model_domain'}
        candidates = []
        scored = {}
        for factor in FACTORS:
            prices = tuple(round_nightly_vnd(price * factor) for price in policy)
            candidate = {'factor': str(factor), 'nightly_prices': [int(p) for p in prices],
                         'total': int(sum(prices)), 'status': 'rejected_business_constraints'}
            if valid(prices):
                if model.in_domain(core, prices):
                    candidate['status'] = 'eligible'
                    if prices not in scored:
                        probability = float(model.predict_acceptance(core, prices))
                        if not math.isfinite(probability) or not 0 <= probability <= 1:
                            raise ValueError('Invalid model probability')
                        contribution = sum(prices) - sum(n.variable_cost for n in nights)
                        scored[prices] = (probability, contribution * Decimal(str(probability)))
                    probability, score = scored[prices]
                    candidate.update(probability=probability, expected_contribution=str(score))
                    candidates.append((score, -abs(factor - 1), -sum(prices), factor, prices, probability))
                else:
                    candidate['status'] = 'rejected_model_domain'
            result['candidates'].append(candidate)
        if not candidates:
            return result | {'reason': 'no_eligible_candidates'}
        _, _, _, factor, prices, probability = max(candidates)
        return result | {'effective_source': 'lab_test_fixture' if mode == 'lab' else 'policy_with_shadow',
                         'model_version': model.version, 'reason': 'shadow_only' if mode == 'shadow' else 'lab_only',
                         'probability_at_displayed_price': scored[policy][0],
                         'probability_at_proposed_price': probability,
                         'proposed_nightly_prices': [int(p) for p in prices], 'proposed_total': int(sum(prices)),
                         'chosen_factor': str(factor)}
    except Exception as error:
        # Never expose a partly scored probability or select from an incomplete
        # search after a model/domain failure. Backend policy remains intact.
        return result | {'reason': 'model_error', 'error_type': type(error).__name__, 'candidates': []}
