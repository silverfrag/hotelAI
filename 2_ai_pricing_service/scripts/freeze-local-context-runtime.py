"""Version a runtime freeze only after the real adapter resource probe passes."""
import argparse
import hashlib
import inspect
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / "2_ai_pricing_service"))
from app.services.local_market_context import RUNTIME, LinkedEvents, complete_local
from app.services.market_context import GroundedContextAnalyzer

parser = argparse.ArgumentParser()
parser.add_argument('probe_directory')
parser.add_argument('--version', choices=['v1', 'v2'], default='v1')
args = parser.parse_args()
run = root / 'artifacts/hotelai-ai-v1/20261029-092250'
m0 = run / 'M0'
probe = m0 / args.probe_directory
if probe.parent.resolve() != m0.resolve():
    raise ValueError("Resource evidence must be inside this M0 run")
report = json.loads((probe / "report.json").read_text(encoding="utf8"))
assert report["memory_gate_passed"] and report["health_passed"] and report["extraction_transport_verified"]
assert report["runtime"]["num_ctx"] == RUNTIME["num_ctx"]
assert report['runtime'].get('version') == RUNTIME['version']
tags = next(row["body"] for row in json.loads((probe / "health-after.json").read_text()) if row["url"].endswith("api/tags"))
assert any(row["name"] == RUNTIME["model"] and row["digest"] == RUNTIME["digest"] for row in tags["models"])
restore = root / ".tmp/ai-v1-local/hotelai_ai_v1_restore_20261107081800.report.json"
backup = json.loads(restore.read_text(encoding="utf-8-sig"))
assert backup["exact_contents_verified"] and backup["tables_verified"] >= 27
destination = (m0 if args.version == 'v1' else run / 'M2') / ('runtime-freeze-' + args.version)
destination.mkdir(exist_ok=False)
digest = lambda data: hashlib.sha256(data).hexdigest()
files = ["2_ai_pricing_service/app/core/local_context_runtime.json",
         "2_ai_pricing_service/app/core/evidence_dates.py",
         "2_ai_pricing_service/app/schemas/market_pricing_schema.py",
         "2_ai_pricing_service/app/services/local_market_context.py",
         "2_ai_pricing_service/app/services/market_context.py",
         "2_ai_pricing_service/app/services/context_job_store.py",
         "1_infrastructure/operations/ai-v1-local.ps1",
         "1_infrastructure/operations/compose.ai-v1.yml"]
manifest = {
    "frozen_at": datetime.now(timezone.utc).isoformat(), "runtime": RUNTIME,
    "approval": "User approved initial M2 dev/schema/prompt/normalization changes and refreeze in chat 2026-11-07" if args.version == 'v2' else 'M0 approved plan',
    "schema_sha256": digest(json.dumps(LinkedEvents.model_json_schema(), sort_keys=True).encode()),
    "prompt_and_transport_sha256": digest(inspect.getsource(complete_local).encode()),
    "worker_initialization_sha256": digest(inspect.getsource(GroundedContextAnalyzer.__init__).encode()),
    "source_files": [{"path": name, "sha256": digest((root / name).read_bytes())} for name in files],
    "resource_evidence": str(probe.relative_to(root)),
    "hardware": {"cpu": "Intel Core i7-1165G7", "cores": 4, "logical_threads": 8, "ram_gib": 15.79,
                 "inference_device": "CPU; integrated GPU not budgeted"},
    "limits": {"compose_memory": "enforced", "native_memory": "monitored, not OS-enforced"},
    "frozen": True, "quality_gate_approved": False, "p95_approved": False,
    "changes_affecting_inference_require_approval_and_reevaluation": True,
}
(destination / "runtime.json").write_text(json.dumps(manifest, indent=2), encoding="utf8")
shutil.copyfile(restore, destination / "restore-report.json")
for name in ["report.json", "health-after.json", "resource-samples.json"]:
    shutil.copyfile(probe / name, destination / name)
evidence_manifest = [{"file": file.name, "sha256": digest(file.read_bytes())}
                     for file in sorted(destination.iterdir()) if file.is_file()]
(destination / "manifest.json").write_text(json.dumps(evidence_manifest, indent=2), encoding="utf8")
print(json.dumps({"runtime_frozen": True, "evidence": str(destination.relative_to(root)),
                  "quality_gate_approved": False, "p95_approved": False}))
