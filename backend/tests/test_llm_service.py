"""Tests for app.services.llm module."""

from unittest.mock import MagicMock, patch

import pytest


def test_get_provider_default_stub(db):
    with patch.dict("os.environ", {"LLM_PROVIDER": "stub"}, clear=False):
        from app.services.llm import StubProvider, get_provider

        provider = get_provider(db)
        assert isinstance(provider, StubProvider)


def test_get_provider_unset_returns_stub(db):
    with patch.dict("os.environ", {}, clear=False):
        from app.services.llm import StubProvider, get_provider

        provider = get_provider(db)
        assert isinstance(provider, StubProvider)


def test_get_provider_claude(db):
    with patch.dict("os.environ", {"LLM_PROVIDER": "claude", "LLM_API_KEY": "test-key"}, clear=False):
        mock_anthropic = MagicMock()
        mock_anthropic.AsyncAnthropic.return_value = MagicMock()
        with patch.dict("sys.modules", {"anthropic": mock_anthropic}):
            from app.services.llm import ClaudeProvider, get_provider

            provider = get_provider(db)
            assert isinstance(provider, ClaudeProvider)


def test_get_provider_openai(db):
    with patch.dict("os.environ", {"LLM_PROVIDER": "openai", "LLM_API_KEY": "test-key"}, clear=False):
        mock_openai = MagicMock()
        mock_openai.AsyncOpenAI.return_value = MagicMock()
        with patch.dict("sys.modules", {"openai": mock_openai}):
            from app.services.llm import OpenAIProvider, get_provider

            provider = get_provider(db)
            assert isinstance(provider, OpenAIProvider)


def test_get_provider_prefers_db_override_over_env(db):
    """A Settings-page change beats the env var without a restart (ADR-0096)."""
    from app.services import llm_settings
    from app.services.llm import StubProvider, get_provider

    with patch.dict("os.environ", {"LLM_PROVIDER": "claude", "LLM_API_KEY": "env-key"}, clear=False):
        llm_settings.update(db, {"provider": "stub"})
        provider = get_provider(db)
        assert isinstance(provider, StubProvider)


def test_get_provider_falls_back_to_env_when_no_override(db):
    with patch.dict("os.environ", {"LLM_PROVIDER": "openai", "LLM_API_KEY": "env-key"}, clear=False):
        mock_openai = MagicMock()
        mock_openai.AsyncOpenAI.return_value = MagicMock()
        with patch.dict("sys.modules", {"openai": mock_openai}):
            from app.services.llm import OpenAIProvider, get_provider

            provider = get_provider(db)
            assert isinstance(provider, OpenAIProvider)
            mock_openai.AsyncOpenAI.assert_called_with(api_key="env-key")


@pytest.mark.asyncio
async def test_stub_provider_chat():
    from app.services.llm import StubProvider

    provider = StubProvider()
    events = []
    async for event in provider.chat(messages=[], tools=[]):
        events.append(event)
    assert len(events) == 2
    # An unconfigured provider reports a configuration error, not an answer, so
    # the router never persists it as a turn in the conversation (ADR-0089).
    assert events[0]["type"] == "error"
    assert "configured" in events[0]["message"]
    assert events[1]["type"] == "done"
