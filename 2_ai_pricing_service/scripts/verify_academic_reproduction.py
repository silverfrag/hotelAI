"""Verify manifests and semantic reproduction; tolerate only floating point roundoff."""
import argparse
import hashlib
import json
import math
from pathlib import Path


def checked(directory):
    manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf8'))
    for name in ('bundle.joblib', 'report.json', 'holdout.json'):
        assert hashlib.sha256((directory / name).read_bytes()).hexdigest() == manifest['files'][name], name
    return manifest


def compare(left, right, path='root'):
    if isinstance(left, dict):
        assert isinstance(right, dict) and left.keys() == right.keys(), path
        return max((compare(left[k], right[k], f'{path}.{k}') for k in left), default=0)
    if isinstance(left, list):
        assert isinstance(right, list) and len(left) == len(right), path
        return max((compare(a, b, f'{path}[{i}]') for i, (a, b) in enumerate(zip(left, right))), default=0)
    if isinstance(left, (int, float)) and not isinstance(left, bool):
        assert isinstance(right, (int, float)) and math.isclose(left, right, rel_tol=1e-12, abs_tol=1e-10), (path, left, right)
        return abs(left-right)
    assert left == right, (path, left, right)
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reference', type=Path)
    parser.add_argument('reproduction', type=Path)
    args = parser.parse_args()
    original, repeated = checked(args.reference), checked(args.reproduction)
    assert original['model_version'] == repeated['model_version']
    for name in ('report.json', 'holdout.json'):
        values = [json.loads((directory/name).read_text(encoding='utf8')) for directory in (args.reference, args.reproduction)]
        maximum = compare(*values)
        print(f'PASS {name}: max absolute numeric difference={maximum:.3g}')
    print(f'PASS {original["model_version"]}; manifests valid. Binary equality is not required across training runs.')


if __name__ == '__main__':
    main()
