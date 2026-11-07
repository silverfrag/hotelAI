"""Fact-level Qwen evaluation after approved reference labels and adjudication.

This module does not call a model or label its outputs. Matching must be supplied
by a source-based adjudicator and is one-to-one; duplicate predictions are FPs.
"""
import random


def _ratio(numerator, denominator):
    return numerator / denominator if denominator else None


def _metrics(rows):
    tp = sum(row['true_positives'] for row in rows)
    fp = sum(row['predictions'] - row['true_positives'] for row in rows)
    fn = sum(row['reference_facts'] - row['true_positives'] for row in rows)
    return {'true_positives': tp, 'false_positives': fp, 'false_negatives': fn,
            'precision': _ratio(tp, tp + fp), 'recall': _ratio(tp, tp + fn)}


def _percentile(values, probability):
    values = sorted(values)
    if not values:
        return None
    index = (len(values) - 1) * probability
    lower = int(index)
    upper = min(lower + 1, len(values) - 1)
    return values[lower] + (index - lower) * (values[upper] - values[lower])


def fact_evaluation(documents, *, resamples=1000, seed=20261107):
    """Input rows: ID, cluster, approved flag, gold/prediction counts and matches.

    Each match has reference_index, prediction_index and support_verified=True,
    meaning type, geography, effective dates AND actual evidence support the
    claim. Index matching alone must never be represented as semantic proof.
    Failed extraction still contributes its reference facts as false negatives.
    """
    if not documents or len({d['document_id'] for d in documents}) != len(documents):
        raise ValueError('Documents must be nonempty and unique')
    if not isinstance(resamples, int) or resamples < 1000:
        raise ValueError('At least 1000 bootstrap resamples required')
    rows = []
    clusters = {}
    for doc in documents:
        if doc.get('reference_user_approved') is not True or not doc.get('adjudication_complete'):
            raise ValueError('Reference approval and source-based adjudication are required')
        gold, predictions = doc['reference_facts'], doc['predictions']
        if any(type(count) is not int or count < 0 for count in (gold, predictions)):
            raise ValueError('Invalid fact count')
        references_seen, predictions_seen = set(), set()
        for match in doc['matches']:
            reference, prediction = match['reference_index'], match['prediction_index']
            if (type(reference) is not int or type(prediction) is not int
                    or not 0 <= reference < gold or not 0 <= prediction < predictions
                    or reference in references_seen or prediction in predictions_seen
                    or match.get('support_verified') is not True):
                raise ValueError('Matches require one-to-one supported facts')
            references_seen.add(reference)
            predictions_seen.add(prediction)
        row = {'document_id': doc['document_id'], 'reference_facts': gold,
               'predictions': predictions, 'true_positives': len(doc['matches'])}
        rows.append(row)
        cluster = doc.get('event_cluster')
        if not isinstance(cluster, str) or not cluster:
            raise ValueError('A document/event cluster is required')
        clusters.setdefault(cluster, []).append(row)
    point = _metrics(rows)
    rng = random.Random(seed)
    keys = sorted(clusters)
    draws = {'precision': [], 'recall': []}
    for _ in range(resamples):
        sampled = [row for key in rng.choices(keys, k=len(keys)) for row in clusters[key]]
        metrics = _metrics(sampled)
        for metric in draws:
            if metrics[metric] is not None:
                draws[metric].append(metrics[metric])
    intervals = {metric: {'low': _percentile(values, .025), 'high': _percentile(values, .975),
                           'defined_resamples': len(values), 'undefined_resamples': resamples - len(values)}
                 for metric, values in draws.items()}
    positive_clusters = sum(any(row['reference_facts'] for row in group) for group in clusters.values())
    warnings = []
    if positive_clusters < 3:
        warnings.append('Few independent positive clusters; evidence is weak even if point gates pass.')
    if any(interval['undefined_resamples'] for interval in intervals.values()):
        warnings.append('Some bootstrap samples have no denominator; their metric is undefined, not zero.')
    return point | {'confidence_level': .95, 'confidence_intervals': intervals,
                    'bootstrap': {'resamples': resamples, 'seed': seed, 'unit': 'document/event_cluster'},
                    'documents': len(rows), 'reference_facts': sum(r['reference_facts'] for r in rows),
                    'predictions': sum(r['predictions'] for r in rows), 'clusters': len(clusters),
                    'positive_clusters': positive_clusters, 'warnings': warnings,
                    'point_gate_passed': (point['precision'] is not None and point['recall'] is not None
                                          and point['precision'] >= .90 and point['recall'] >= .70),
                    'operational_feature_enabled': False}
