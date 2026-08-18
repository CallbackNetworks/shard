"""Tests for the assistant router: conversation CRUD, plus the streaming message
endpoint against a mocked provider (no real LLM streaming test beyond that)."""

from unittest.mock import patch

from app.models import AssistantConversation, AssistantMessage


class _RecordingProvider:
    """Records exactly what it was called with; yields a canned reply + usage."""

    def __init__(self, reply="a canned answer", usage=None):
        self.reply = reply
        self.usage = usage
        self.calls: list[dict] = []

    async def chat(self, messages, tools, system=None):
        self.calls.append({"messages": messages, "tools": tools, "system": system})
        yield {"type": "text", "text": self.reply}
        if self.usage:
            yield {"type": "usage", **self.usage}
        yield {"type": "done"}


def test_list_conversations_empty(client):
    r = client.get("/api/assistant/conversations")
    assert r.status_code == 200
    assert r.json() == []


def test_create_conversation(client):
    r = client.post("/api/assistant/conversations")
    assert r.status_code == 201
    data = r.json()
    assert "id" in data
    assert data["title"] == "New conversation"
    assert "messages" in data


def test_get_conversation(client, db):
    conv = AssistantConversation()
    db.add(conv)
    db.commit()
    db.refresh(conv)

    r = client.get(f"/api/assistant/conversations/{conv.id}")
    assert r.status_code == 200
    assert r.json()["id"] == conv.id


def test_get_conversation_not_found(client):
    r = client.get("/api/assistant/conversations/nonexistent")
    assert r.status_code == 404


def test_delete_conversation(client, db):
    conv = AssistantConversation()
    db.add(conv)
    db.commit()
    db.refresh(conv)

    r = client.delete(f"/api/assistant/conversations/{conv.id}")
    assert r.status_code == 204

    r = client.get(f"/api/assistant/conversations/{conv.id}")
    assert r.status_code == 404


def test_delete_conversation_not_found(client):
    r = client.delete("/api/assistant/conversations/nonexistent")
    assert r.status_code == 404


def test_list_conversations_after_create(client, db):
    conv = AssistantConversation(title="Test Chat")
    db.add(conv)
    db.commit()

    r = client.get("/api/assistant/conversations")
    assert r.status_code == 200
    data = r.json()
    assert len(data) >= 1
    assert any(c["title"] == "Test Chat" for c in data)


def test_search_conversations(client, db):
    conv = AssistantConversation(title="Deployment Help")
    db.add(conv)
    db.flush()
    msg = AssistantMessage(conversation_id=conv.id, role="user", content="How do I deploy?")
    db.add(msg)
    db.commit()

    # Search by title
    r = client.get("/api/assistant/conversations", params={"q": "Deployment"})
    assert r.status_code == 200
    assert len(r.json()) >= 1

    # Search by message content
    r = client.get("/api/assistant/conversations", params={"q": "deploy"})
    assert r.status_code == 200
    assert len(r.json()) >= 1


def test_send_message_to_nonexistent_conversation(client):
    r = client.post(
        "/api/assistant/conversations/nonexistent/messages",
        json={"content": "Hello"},
    )
    assert r.status_code == 404


def test_send_message_persists_the_reply_and_its_token_usage(client, db):
    conv = AssistantConversation()
    db.add(conv)
    db.commit()
    db.refresh(conv)

    fake = _RecordingProvider(reply="here is your summary", usage={"input_tokens": 200, "output_tokens": 40})
    with patch("app.routers.assistant.get_provider", return_value=fake):
        r = client.post(f"/api/assistant/conversations/{conv.id}/messages", json={"content": "Summarize my day"})
    assert r.status_code == 200

    saved = (
        db.query(AssistantMessage)
        .filter(AssistantMessage.conversation_id == conv.id, AssistantMessage.role == "assistant")
        .first()
    )
    assert saved.content == "here is your summary"
    assert saved.input_tokens == 200
    assert saved.output_tokens == 40


def test_send_message_without_usage_leaves_token_columns_null(client, db):
    """StubProvider (or any provider that doesn't report usage) must not be recorded as
    a free reply — null means unreported, not zero (ADR-0100)."""
    conv = AssistantConversation()
    db.add(conv)
    db.commit()
    db.refresh(conv)

    fake = _RecordingProvider(reply="no usage here")
    with patch("app.routers.assistant.get_provider", return_value=fake):
        client.post(f"/api/assistant/conversations/{conv.id}/messages", json={"content": "Hi"})

    saved = (
        db.query(AssistantMessage)
        .filter(AssistantMessage.conversation_id == conv.id, AssistantMessage.role == "assistant")
        .first()
    )
    assert saved.input_tokens is None
    assert saved.output_tokens is None
