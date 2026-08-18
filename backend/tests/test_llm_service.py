"""Tests for app.services.llm module."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

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
            mock_openai.AsyncOpenAI.assert_called_with(api_key="env-key", base_url=None)


def test_get_provider_passes_base_url_through(db):
    """A Cloudflare AI Gateway / self-hosted OpenAI-compatible endpoint is reached with
    the same provider="openai" and a custom base_url, no new provider class (ADR-0097)."""
    from app.services import llm_settings

    with patch.dict("os.environ", {}, clear=False):
        llm_settings.update(
            db,
            {"provider": "openai", "api_key": "gw-key", "base_url": "https://gateway.example/v1"},
        )
        mock_openai = MagicMock()
        mock_openai.AsyncOpenAI.return_value = MagicMock()
        with patch.dict("sys.modules", {"openai": mock_openai}):
            from app.services.llm import get_provider

            get_provider(db)
            mock_openai.AsyncOpenAI.assert_called_with(api_key="gw-key", base_url="https://gateway.example/v1")


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


class _FakeAnthropicStream:
    """Mimics ``anthropic.AsyncAnthropic().messages.stream(...)``'s async context
    manager + async-iterator + ``get_final_message()`` shape."""

    def __init__(self, events, final_message):
        self._events = events
        self._final_message = final_message

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def __aiter__(self):
        return self._iter()

    async def _iter(self):
        for e in self._events:
            yield e

    async def get_final_message(self):
        return self._final_message


@pytest.mark.asyncio
async def test_claude_provider_yields_usage_from_the_final_message():
    """msg.usage was already sitting in the SDK response, just never read (ADR-0100)."""
    mock_anthropic = MagicMock()
    final_message = SimpleNamespace(content=[], usage=SimpleNamespace(input_tokens=120, output_tokens=45))
    fake_stream = _FakeAnthropicStream([SimpleNamespace(type="message_stop")], final_message)
    mock_anthropic.AsyncAnthropic.return_value.messages.stream = MagicMock(return_value=fake_stream)

    with patch.dict("sys.modules", {"anthropic": mock_anthropic}):
        from app.services.llm import ClaudeProvider

        provider = ClaudeProvider(api_key="k", model="claude-sonnet-4-6")
        events = [e async for e in provider.chat(messages=[{"role": "user", "content": "hi"}], tools=[])]

    usage_events = [e for e in events if e["type"] == "usage"]
    assert usage_events == [{"type": "usage", "input_tokens": 120, "output_tokens": 45}]
    assert events[-1]["type"] == "done"


@pytest.mark.asyncio
async def test_openai_provider_yields_usage_from_the_trailing_chunk():
    """The usage-only chunk (choices=[]) arrives after the finish_reason chunk — the loop
    must not `break` before it, or stream_options.include_usage buys nothing (ADR-0100)."""
    mock_openai = MagicMock()

    text_chunk = SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(content="hi", tool_calls=None), finish_reason=None)],
        usage=None,
    )
    finish_chunk = SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(content=None, tool_calls=None), finish_reason="stop")],
        usage=None,
    )
    usage_chunk = SimpleNamespace(choices=[], usage=SimpleNamespace(prompt_tokens=88, completion_tokens=13))

    async def fake_stream():
        for c in (text_chunk, finish_chunk, usage_chunk):
            yield c

    mock_openai.AsyncOpenAI.return_value.chat.completions.create = AsyncMock(return_value=fake_stream())

    with patch.dict("sys.modules", {"openai": mock_openai}):
        from app.services.llm import OpenAIProvider

        provider = OpenAIProvider(api_key="k", model="gpt-5")
        events = [e async for e in provider.chat(messages=[{"role": "user", "content": "hi"}], tools=[])]

    create_kwargs = mock_openai.AsyncOpenAI.return_value.chat.completions.create.call_args.kwargs
    assert create_kwargs["stream_options"] == {"include_usage": True}

    usage_events = [e for e in events if e["type"] == "usage"]
    assert usage_events == [{"type": "usage", "input_tokens": 88, "output_tokens": 13}]
    assert events[-1]["type"] == "done"
