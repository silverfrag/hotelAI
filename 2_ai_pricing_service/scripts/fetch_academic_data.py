"""Fetch the public source without overwriting a different local dataset."""
import argparse
import hashlib
from pathlib import Path
from urllib.request import urlopen

URL = 'https://raw.githubusercontent.com/rfordatascience/tidytuesday/main/data/2020/2020-02-11/hotels.csv'
SHA256 = '7c2ae42a7353905ea136e5c2287f17c92c5435826598bfbb8491c6f0c7b1fc06'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'notebooks/hotel_bookings.csv')
    args = parser.parse_args()
    payload = args.output.read_bytes() if args.output.exists() else urlopen(URL, timeout=60).read()
    actual = hashlib.sha256(payload).hexdigest()
    if actual != SHA256:
        raise SystemExit(f'Checksum mismatch: {actual}. Existing file preserved; investigate source/version.')
    if not args.output.exists():
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('xb') as destination:
            destination.write(payload)
    print(f'PASS source SHA256 {actual}: {args.output}')


if __name__ == '__main__':
    main()
