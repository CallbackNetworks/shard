"""
Provider-agnostic LLM abstraction for the Assistant feature.

Provider/model/key are resolved per call from ``services.llm_settings`` (DB override,
else env var — ADR-0096), not read once at import time, so a change made through
Settings takes effect on the next message without a restart.
"""

import json
import logging
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from sqlalchemy.orm import Session

from app.services import llm_settings

logger = logging.getLogger(__name__)


class LLMProvider(ABC):
    @abstractmethod
    async def chat(
        self,
        messages: list[dict],
        tools: list[dict],
        system: str | None = None,
    ) -> AsyncIterator[dict]:
        """
        Yield event dicts:
          {"type": "text", "text": "..."}
          {"type": "tool_call", "name": "...", "input": {...}, "id": "..."}
          {"type": "done"}
        """
        ...


class StubProvider(LLMProvider):
    """The no-provider case. It reports a *configuration* problem, not an answer.

    This used to yield the notice as a `text` event, so the router persisted
    "LLM provider not configured..." into the conversation as something the
    assistant had said — a deployment detail became permanent chat history, and
    it stayed there after the provider was configured (ADR-0089).
    """

    async def chat(self, messages, tools, system=None):
        yield {
            "type": "error",
            "message": (
                "No LLM provider is configured. Set it in Settings, or via the "
                "LLM_PROVIDER (claude|openai)/LLM_API_KEY/LLM_MODEL env vars."
            ),
        }
        yield {"type": "done"}


class ClaudeProvider(LLMProvider):
    def __init__(self, api_key: str, model: str):
        try:
            import anthropic

            self.client = anthropic.AsyncAnthropic(api_key=api_key)
            self.model = model or "claude-sonnet-4-6"
        except ImportError as err:
            raise RuntimeError("anthropic package not installed. Add 'anthropic' to requirements.txt") from err

    async def chat(self, messages, tools, system=None):
        formatted_tools = [
            {
                "name": t["name"],
                "description": t["description"],
                "input_schema": t["input_schema"],
            }
            for t in tools
        ]
        kwargs = {
            "model": self.model,
            "max_tokens": 4096,
            "messages": messages,
            "tools": formatted_tools,
        }
        if system:
            kwargs["system"] = system

        async with self.client.messages.stream(**kwargs) as stream:
            async for event in stream:
                if hasattr(event, "type"):
                    if event.type == "content_block_delta":
                        if hasattr(event.delta, "text"):
                            yield {"type": "text", "text": event.delta.text}
                        elif hasattr(event.delta, "partial_json"):
                            pass  # handled at stop_reason
                    elif event.type == "message_stop":
                        msg = await stream.get_final_message()
                        for block in msg.content:
                            if block.type == "tool_use":
                                yield {"type": "tool_call", "name": block.name, "input": block.input, "id": block.id}
                        yield {"type": "done"}
                        return

        yield {"type": "done"}


class OpenAIProvider(LLMProvider):
    def __init__(self, api_key: str, model: str):
        try:
            from openai import AsyncOpenAI

            self.client = AsyncOpenAI(api_key=api_key)
            self.model = model or "gpt-4o"
        except ImportError as err:
            raise RuntimeError("openai package not installed. Add 'openai' to requirements.txt") from err

    async def chat(self, messages, tools, system=None):
        formatted_tools = [
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t["description"],
                    "parameters": t["input_schema"],
                },
            }
            for t in tools
        ]
        formatted_messages = []
        if system:
            formatted_messages.append({"role": "system", "content": system})
        for m in messages:
            formatted_messages.append({"role": m["role"], "content": m["content"]})

        stream = await self.client.chat.completions.create(
            model=self.model,
            messages=formatted_messages,
            tools=formatted_tools if formatted_tools else None,
            stream=True,
        )

        tool_calls_acc = {}  # index -> {id, name, arguments_str}
        async for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if not delta:
                continue
            if delta.content:
                yield {"type": "text", "text": delta.content}
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = tc.index
                    if idx not in tool_calls_acc:
                        tool_calls_acc[idx] = {"id": tc.id or "", "name": tc.function.name or "", "arguments": ""}
                    if tc.id:
                        tool_calls_acc[idx]["id"] = tc.id
                    if tc.function.name:
                        tool_calls_acc[idx]["name"] = tc.function.name
                    if tc.function.arguments:
                        tool_calls_acc[idx]["arguments"] += tc.function.arguments
            if chunk.choices[0].finish_reason:
                break

        for idx in sorted(tool_calls_acc.keys()):
            tc = tool_calls_acc[idx]
            try:
                inp = json.loads(tc["arguments"]) if tc["arguments"] else {}
            except json.JSONDecodeError:
                inp = {}
            yield {"type": "tool_call", "name": tc["name"], "input": inp, "id": tc["id"]}

        yield {"type": "done"}


def get_provider(db: Session) -> LLMProvider:
    config = llm_settings.get_effective_llm_config(db)
    if config["provider"] == "claude":
        return ClaudeProvider(api_key=config["api_key"], model=config["model"])
    elif config["provider"] == "openai":
        return OpenAIProvider(api_key=config["api_key"], model=config["model"])
    return StubProvider()
