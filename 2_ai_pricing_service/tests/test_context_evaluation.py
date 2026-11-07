"""Synthetic count fixtures test the evaluator, never the Qwen quality gate."""
import pytest
from app.training.context_evaluation import fact_evaluation


def row(identifier, gold, predicted, matches=0, cluster=None):
    return {'document_id': identifier, 'event_cluster': cluster or identifier,
            'reference_user_approved': True, 'adjudication_complete': True,
            'reference_facts': gold, 'predictions': predicted,
            'matches': [{'reference_index': i, 'prediction_index': i, 'support_verified': True} for i in range(matches)]}


def test_fact_counts_ci_and_gate_are_separate_from_enabling():
    report = fact_evaluation([row('a', 2, 3, 2), row('b', 1, 0), row('c', 0, 0)])
    assert report['true_positives'] == 2 and report['false_positives'] == 1 and report['false_negatives'] == 1
    assert report['precision'] == pytest.approx(2 / 3) and report['recall'] == pytest.approx(2 / 3)
    assert report['confidence_intervals']['recall']['low'] == 0
    assert report['point_gate_passed'] is False and report['operational_feature_enabled'] is False
    assert report['positive_clusters'] == 2 and report['warnings']


def test_duplicate_predictions_are_not_extra_true_positives():
    report = fact_evaluation([row('a', 1, 2, 1)])
    assert report['precision'] == .5 and report['recall'] == 1
    duplicate = row('a', 1, 2, 1)
    duplicate['matches'].append({'reference_index': 0, 'prediction_index': 1, 'support_verified': True})
    with pytest.raises(ValueError, match='one-to-one'):
        fact_evaluation([duplicate])


def test_empty_prediction_is_not_perfect_precision_and_missing_labels_cannot_score():
    report = fact_evaluation([row('a', 1, 0)])
    assert report['precision'] is None and report['recall'] == 0 and report['point_gate_passed'] is False
    assert report['confidence_intervals']['precision']['undefined_resamples'] == 1000
    unapproved = row('a', 1, 1, 1) | {'reference_user_approved': False}
    with pytest.raises(ValueError, match='approval'):
        fact_evaluation([unapproved])


def test_bootstrap_keeps_related_articles_together_and_is_reproducible():
    documents = [row('a', 1, 1, 1, 'same_event'), row('b', 1, 1, 1, 'same_event'), row('c', 0, 1)]
    first = fact_evaluation(documents)
    assert first == fact_evaluation(documents)
    assert first['clusters'] == 2 and first['positive_clusters'] == 1
