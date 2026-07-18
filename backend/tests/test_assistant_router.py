"""Tests for the assistant router (conversation CRUD, no LLM streaming)."""

from app.models import AssistantConversation, AssistantMessage


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
