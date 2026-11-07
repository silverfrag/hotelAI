"""Offline boundary cleanup; preserves source text/hash and never invents labels."""
import hashlib
import importlib.util
import json
from pathlib import Path

script = Path(__file__).with_name("collect-reference-documents.py")
spec = importlib.util.spec_from_file_location("reference_boundary", script)
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)
directory = collector.directory
summary = []
for path in sorted(directory.glob("*.json")):
    try:
        document = json.loads(path.read_text(encoding="utf8"))
    except json.JSONDecodeError:
        continue  # A running collector may be completing another file.
    if document.get("source_http_status") != 200:
        continue
    original = document.get("article_text")
    if original is None:
        visible = document["visible_page_text"]
        title = visible.splitlines()[0].split(" - Cổng", 1)[0]
        lines = visible.splitlines()
        starts = [i for i, line in enumerate(lines) if line == title]
        if starts:
            original = "\n".join(lines[starts[0]:])
    already_bounded = "before rating widget" in document.get("extraction_scope", "")
    valid_hash = original and hashlib.sha256(original.encode()).hexdigest() == document.get("article_text_sha256")
    article = original if already_bounded and valid_hash else collector.bounded_article_text(original or "")
    if article:
        document.update(article_text=article, article_text_sha256=hashlib.sha256(article.encode()).hexdigest(),
                        extraction_scope="article heading to before rating widget; human boundary review pending")
        path.write_text(json.dumps(document, indent=2, ensure_ascii=False), encoding="utf8")
        summary.append({"id": path.stem, "source_url": document["source_url"], "title": article.splitlines()[0],
                        "characters": len(article), "text_sha256": document["article_text_sha256"]})
(directory.parent / "reference-candidate-index.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf8")
print(json.dumps({"http_200_documents_with_article_boundary": len(summary), "approved_gold_documents": 0}))
