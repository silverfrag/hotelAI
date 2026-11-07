"""M0 infrastructure fixture, never real corpus data or a quality evaluation."""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["MARKET_CONTEXT_MODEL"] = "qwen3:1.7b"
os.environ["MARKET_CONTEXT_OLLAMA_URL"] = "http://127.0.0.1:11435/api/chat"
os.environ["MARKET_CONTEXT_OUTPUT_DIR"] = str(Path(__file__).resolve().parents[2] / ".tmp/ai-v1-local/probe-output")
from app.services.local_market_context import complete_local, RUNTIME

events, inference = complete_local([{
    "source_id": "infrastructure_fixture",
    "text": "[TEST_FIXTURE — không phải dữ liệu thị trường thật]\nHội nghị thử nghiệm\nĐịa điểm: Đà Nẵng.\nTừ 15/11/2026 đến 17/11/2026.",
}], "")
print(json.dumps({"kind": "infrastructure_test_fixture", "runtime": RUNTIME,
                  "events": events, "inference": inference}, ensure_ascii=True))
