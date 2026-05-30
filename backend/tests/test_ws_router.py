"""Tests for the WebSocket router."""


def test_websocket_connect_and_disconnect(client):
    """Test basic WebSocket connection lifecycle."""
    with client.websocket_connect("/ws") as ws:
        # Connection established; just close it
        pass
    # If we reach here, connect + disconnect succeeded


def test_websocket_send_receive(client):
    """Test that the server accepts text messages (it reads but doesn't echo)."""
    with client.websocket_connect("/ws") as ws:
        ws.send_text("ping")
        # Server reads but doesn't respond; just verify no crash
