"""Tests for app.services.llm module."""

from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture(autouse=True)
def reset_module():
    """Ensure fresh import each test."""
    import importlib

    import app.services.llm as llm_mod

    yield
    importlib.reload(llm_mod)


def test_get_provider_default_stub():
    with patch.dict("os.environ", {"LLM_PROVIDER": "stub"}, clear=False):
        import importlib

        import app.services.llm as llm_mod

        importlib.reload(llm_mod)
        provider = llm_mod.get_provider()
        assert isinstance(provider, llm_mod.StubProvider)


def test_get_provider_unset_returns_stub():
    with patch.dict("os.environ", {}, clear=False):
        import importlib

        import app.services.llm as llm_mod

        importlib.reload(llm_mod)
        provider = llm_mod.get_provider()
        assert isinstance(provider, llm_mod.StubProvider)


def test_get_provider_claude():
    with patch.dict("os.environ", {"LLM_PROVIDER": "claude", "LLM_API_KEY": "test-key"}, clear=False):
        mock_anthropic = MagicMock()
        mock_anthropic.AsyncAnthropic.return_value = MagicMock()
        with patch.dict("sys.modules", {"anthropic": mock_anthropic}):
            import importlib

            import app.services.llm as llm_mod

            importlib.reload(llm_mod)
            provider = llm_mod.get_provider()
            assert isinstance(provider, llm_mod.ClaudeProvider)


def test_get_provider_openai():
    with patch.dict("os.environ", {"LLM_PROVIDER": "openai", "LLM_API_KEY": "test-key"}, clear=False):
        mock_openai = MagicMock()
        mock_openai.AsyncOpenAI.return_value = MagicMock()
        with patch.dict("sys.modules", {"openai": mock_openai}):
            import importlib

            import app.services.llm as llm_mod

            importlib.reload(llm_mod)
            provider = llm_mod.get_provider()
            assert isinstance(provider, llm_mod.OpenAIProvider)


@pytest.mark.asyncio
async def test_stub_provider_chat():
    from app.services.llm import StubProvider

    provider = StubProvider()
    events = []
    async for event in provider.chat(messages=[], tools=[]):
        events.append(event)
    assert len(events) == 2
    assert events[0]["type"] == "text"
    assert "not configured" in events[0]["text"]
    assert events[1]["type"] == "done"
