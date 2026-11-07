"""Bounded JSON checkpoints for the single local context worker; no pickle/SQL."""
import hashlib
import json
import os
import time
import uuid
import math
from pathlib import Path


class ContextJobStore:
    max_bytes = 512_000
    ttl_seconds = 900

    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)

    def path(self, key):
        name = hashlib.sha256(json.dumps(key, sort_keys=True).encode()).hexdigest()
        return self.directory / (name + '.json')

    def read(self, key):
        path = self.path(key)
        try:
            if path.stat().st_size > self.max_bytes:
                return None
            data = json.loads(path.read_text(encoding='utf8'))
            if not self.valid_record(data) or tuple(data['key']) != tuple(key):
                return None
            return data
        except (OSError, ValueError):
            return None

    @staticmethod
    def valid_record(data):
        return (isinstance(data, dict) and data.get('schema_version') == 1
                and isinstance(data.get('key'), list)
                and all(isinstance(part, str) for part in data['key'])
                and isinstance(data.get('documents'), list)
                and data.get('status') in ('queued', 'running', 'completed', 'failed')
                and all(isinstance(data.get(field), (int, float))
                        and math.isfinite(data[field]) for field in ('created_at_epoch', 'updated_at_epoch')))

    def save(self, key, documents, status, *, result=None, error_type=None):
        old = self.read(key)
        record = {'schema_version': 1, 'key': list(key), 'status': status, 'documents': documents,
                  'created_at_epoch': old['created_at_epoch'] if old else time.time(),
                  'updated_at_epoch': time.time(), 'result': result, 'error_type': error_type}
        raw = json.dumps(record, ensure_ascii=False).encode('utf8')
        if len(raw) > self.max_bytes:
            raise ValueError('Context job checkpoint exceeds size budget')
        temporary = self.directory / (uuid.uuid4().hex + '.tmp')
        try:
            with temporary.open('xb') as out:
                out.write(raw)
                out.flush()
                os.fsync(out.fileno())
            os.replace(temporary, self.path(key))
        finally:
            temporary.unlink(missing_ok=True)
        # Only discard old completed/failed cache entries; never active work.
        paths = sorted(self.directory.glob('*.json'), key=lambda path: path.stat().st_mtime)
        for path in paths[:-64]:
            try:
                data = json.loads(path.read_text(encoding='utf8'))
                if self.valid_record(data) and data['status'] in ('completed', 'failed'):
                    path.unlink()
            except (OSError, ValueError):
                continue

    def completed(self, key):
        data = self.read(key)
        if data and data['status'] == 'completed' and 0 <= time.time() - data['updated_at_epoch'] <= self.ttl_seconds:
            return data.get('result')
        return None

    def resumable(self):
        results = []
        for path in self.directory.glob('*.json'):
            try:
                if path.stat().st_size > self.max_bytes:
                    continue
                data = json.loads(path.read_text(encoding='utf8'))
                if (self.valid_record(data) and path == self.path(data['key'])
                        and data['status'] in ('queued', 'running')
                        and 0 <= time.time() - data['updated_at_epoch'] <= self.ttl_seconds):
                    results.append(data)
            except (OSError, ValueError, KeyError, TypeError):
                continue
        return sorted(results, key=lambda data: data['created_at_epoch'])[:2]
