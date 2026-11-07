import importlib.util
from pathlib import Path


def collector():
    path = Path(__file__).resolve().parents[1] / 'scripts/collect-reference-documents.py'
    spec = importlib.util.spec_from_file_location('reference_collector_test', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_recommendations_and_cms_objects_cannot_become_article_facts():
    module = collector()
    article = ('A real source title\n' + 'Explicit source paragraph. ' * 5).rstrip()
    text = article + '\nĐánh giá bài viết:\nOther story with different dates\n{mvccVersion=123}'
    assert module.bounded_article_text(text) == article
    assert module.bounded_article_text('Unrecognized page template') is None


def test_dom_region_does_not_execute_scripts_or_include_site_header():
    module = collector()
    parser = module.ArticleText()
    parser.feed('<header>Site menu</header><div class="detail__main"><h2>Actual title</h2>'
                '<p>Actual source text</p><script>untrusted()</script></div><footer>Other pages</footer>')
    assert len(parser.article_regions) == 1
    assert 'Actual source text' in parser.article_regions[0]
    assert 'untrusted()' not in parser.article_regions[0]
    assert 'Site menu' not in parser.article_regions[0]
    assert 'Other pages' not in parser.article_regions[0]
