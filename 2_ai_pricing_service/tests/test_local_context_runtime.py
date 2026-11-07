import pytest

from app.services.local_market_context import RUNTIME, input_token_upper_bound, validate_input_budget


def test_multibyte_source_cannot_exceed_the_context_silently():
    body = {"messages": [{"content": "Đà Nẵng " * 2000}], "format": {"type": "object"}}
    assert input_token_upper_bound(body) > len(body["messages"][0]["content"])
    with pytest.raises(ValueError, match="no inference or silent truncation"):
        validate_input_budget(body)


def test_exact_context_boundary_preserves_output_reserve():
    body = {"messages": [{"content": ""}], "format": {}}
    available = RUNTIME["num_ctx"] - RUNTIME["num_predict"] - input_token_upper_bound(body)
    body["messages"][0]["content"] = "x" * available
    assert validate_input_budget(body) + RUNTIME["num_predict"] == RUNTIME["num_ctx"]
    body["messages"][0]["content"] += "x"
    with pytest.raises(ValueError):
        validate_input_budget(body)
