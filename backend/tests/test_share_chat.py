"""Tests for the public read-only Q&A assistant on the share page (ADR-0098).

The one thing worth losing sleep over: what the model can see must be exactly what
``GET /share/node/{token}`` already returns, and nothing reaches the provider at all
when a PIN gate is unmet. These are asserted directly against the `system` prompt a
recording fake provider receives — not inferred from what the model says back.
"""

import hashlib
import json
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest

from app.models import ApiKey, ShareChatLog
from app.services import graph
from app.services.rate_limiter import _share_chat_limiter, _share_limiter
from tests.factories import make_project


class _RecordingProvider:
    """Records exactly what it was called with; yields a canned reply (+ usage)."""

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


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    _share_limiter._hits.clear()
    _share_chat_limiter._hits.clear()
    yield


def _chat(client, token, content="What's the status of this project?"):
    return client.post(f"/share/node/{token}/chat", json={"messages": [{"role": "user", "content": content}]})


class TestAccessControl:
    def test_unknown_token_is_404(self, client):
        resp = _chat(client, "nonexistent-token")
        assert resp.status_code == 404

    def test_expired_share_is_410(self, client, db):
        identity = graph.create_identity(db, name="Expired")
        graph.update_identity(
            db, identity.id, share_token="expired-chat-token", share_expires_at=datetime.now(UTC) - timedelta(hours=1)
        )
        db.commit()
        resp = _chat(client, "expired-chat-token")
        assert resp.status_code == 410

    def test_pin_locked_share_refuses_before_any_provider_call(self, client, pinned_identity):
        fake = _RecordingProvider()
        with patch("app.routers.share.get_provider", return_value=fake) as mock_get_provider:
            resp = _chat(client, pinned_identity.share_token)
        assert resp.status_code == 403
        mock_get_provider.assert_not_called()
        assert fake.calls == []

    def test_a_valid_pin_session_unlocks_chat(self, client, pinned_identity):
        client.post(f"/share/node/{pinned_identity.share_token}/verify", json={"pin": "1234"})
        fake = _RecordingProvider()
        with patch("app.routers.share.get_provider", return_value=fake):
            resp = _chat(client, pinned_identity.share_token)
        assert resp.status_code == 200
        assert len(fake.calls) == 1

    def test_direct_api_access_works_without_the_page_widget(self, client, sample_identity, sample_project):
        """Confirmed by design (ADR-0098): the token (+ PIN) is the credential, not the
        calling client — a bare POST with no Referer/Origin must succeed."""
        fake = _RecordingProvider()
        with patch("app.routers.share.get_provider", return_value=fake):
            resp = _chat(client, sample_identity.share_token)
        assert resp.status_code == 200


class TestScopedContext:
    def test_the_system_prompt_carries_exactly_what_the_share_page_returns(
        self, client, db, sample_identity, sample_project
    ):
        page = client.get(f"/share/node/{sample_identity.share_token}").json()

        fake = _RecordingProvider()
        with patch("app.routers.share.get_provider", return_value=fake):
            resp = _chat(client, sample_identity.share_token)
        assert resp.status_code == 200

        system = fake.calls[0]["system"]
        embedded = json.loads(system.split("SHARE DATA:\n", 1)[1])
        # meta.generated_at differs by a beat between the two calls; everything else must not.
        embedded["meta"].pop("generated_at")
        page["meta"].pop("generated_at")
        assert embedded == page

    def test_a_different_projects_data_never_appears_in_context(self, client, db, sample_identity, sample_project):
        other = make_project(db, name="Somebody Else's Secret Project")
        db.add(other)
        db.flush()
        db.commit()  # deliberately NOT linked to sample_identity — out of this share's scope

        fake = _RecordingProvider()
        with patch("app.routers.share.get_provider", return_value=fake):
            resp = _chat(client, sample_identity.share_token)
        assert resp.status_code == 200
        assert "Somebody Else's Secret Project" not in fake.calls[0]["system"]

    def test_no_tools_are_offered(self, client, sample_identity, sample_project):
        fake = _RecordingProvider()
        with patch("app.routers.share.get_provider", return_value=fake):
            _chat(client, sample_identity.share_token)
        assert fake.calls[0]["tools"] == []


class TestLoggingAndRateLimit:
    def test_a_successful_exchange_is_logged_against_the_right_node(self, client, db, sample_identity, sample_project):
        fake = _RecordingProvider(reply="the project is on track")
        with patch("app.routers.share.get_provider", return_value=fake):
            resp = _chat(client, sample_identity.share_token, content="How's it going?")
        assert resp.status_code == 200

        rows = db.query(ShareChatLog).filter(ShareChatLog.node_id == sample_identity.id).all()
        assert len(rows) == 1
        assert rows[0].question == "How's it going?"
        assert rows[0].answer == "the project is on track"

    def test_token_usage_is_persisted_when_the_provider_reports_it(self, client, db, sample_identity, sample_project):
        fake = _RecordingProvider(reply="ok", usage={"input_tokens": 300, "output_tokens": 60})
        with patch("app.routers.share.get_provider", return_value=fake):
            _chat(client, sample_identity.share_token)

        row = db.query(ShareChatLog).filter(ShareChatLog.node_id == sample_identity.id).one()
        assert row.input_tokens == 300
        assert row.output_tokens == 60

    def test_no_usage_reported_leaves_token_columns_null_not_zero(self, client, db, sample_identity, sample_project):
        fake = _RecordingProvider(reply="ok")
        with patch("app.routers.share.get_provider", return_value=fake):
            _chat(client, sample_identity.share_token)

        row = db.query(ShareChatLog).filter(ShareChatLog.node_id == sample_identity.id).one()
        assert row.input_tokens is None
        assert row.output_tokens is None

    def test_the_owner_can_read_the_log_but_never_the_ip_hash(self, client, db, sample_identity, sample_project):
        fake = _RecordingProvider()
        with patch("app.routers.share.get_provider", return_value=fake):
            _chat(client, sample_identity.share_token)

        resp = client.get(f"/api/nodes/{sample_identity.id}/share-chat-log")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 1
        assert "ip_hash" not in body[0]
        assert "answer" in body[0] and "question" in body[0]

    def test_rate_limit_trips_before_the_provider_is_ever_called(self, client, sample_identity, sample_project):
        fake = _RecordingProvider()
        with patch("app.routers.share.get_provider", return_value=fake):
            for _ in range(20):
                assert _chat(client, sample_identity.share_token).status_code == 200
            resp = _chat(client, sample_identity.share_token)
        assert resp.status_code == 429
        assert len(fake.calls) == 20

    def test_the_rate_limit_is_scoped_to_one_token(self, client, db, sample_identity, sample_project):
        other_identity = graph.create_identity(db, name="Someone Else")
        graph.update_identity(db, other_identity.id, share_token="a-different-share-token")
        db.commit()

        fake = _RecordingProvider()
        with patch("app.routers.share.get_provider", return_value=fake):
            for _ in range(20):
                assert _chat(client, sample_identity.share_token).status_code == 200
            # A different token is unaffected by the first one's limit.
            assert _chat(client, "a-different-share-token").status_code == 200


class TestOwnerReadBothDoors:
    """ADR-0099: share-chat-log gets a v1 (+ MCP) door, same rule as share-views."""

    def _admin_key(self, db):
        raw = "tdp_test_share_chat_admin"
        db.add(
            ApiKey(
                name="share-chat-admin",
                key_hash=hashlib.sha256(raw.encode()).hexdigest(),
                key_last4=raw[-4:],
                scopes=["read", "write", "admin"],
                active=True,
            )
        )
        db.commit()
        return raw

    def _read_key(self, db):
        raw = "tdp_test_share_chat_read"
        db.add(
            ApiKey(
                name="share-chat-read",
                key_hash=hashlib.sha256(raw.encode()).hexdigest(),
                key_last4=raw[-4:],
                scopes=["read"],
                active=True,
            )
        )
        db.commit()
        return raw

    def test_both_doors_report_the_same_log(self, client, db, sample_identity, sample_project):
        fake = _RecordingProvider(reply="the answer")
        with patch("app.routers.share.get_provider", return_value=fake):
            _chat(client, sample_identity.share_token, content="How's it going?")

        key = self._read_key(db)
        internal = client.get(f"/api/nodes/{sample_identity.id}/share-chat-log").json()
        external = client.get(f"/api/v1/nodes/{sample_identity.id}/share-chat-log", headers={"X-API-Key": key}).json()
        assert len(internal) == len(external) == 1
        assert internal[0]["question"] == external[0]["question"] == "How's it going?"
        assert "ip_hash" not in external[0]

    def test_a_read_scope_key_is_enough(self, client, db, sample_identity, sample_project):
        key = self._read_key(db)
        resp = client.get(f"/api/v1/nodes/{sample_identity.id}/share-chat-log", headers={"X-API-Key": key})
        assert resp.status_code == 200

    def test_no_key_is_refused(self, client, sample_identity, sample_project):
        # X-API-Key is a required header on every v1 route — FastAPI's own 422 for a
        # missing required param, distinct from the 401 an invalid/inactive key gets.
        resp = client.get(f"/api/v1/nodes/{sample_identity.id}/share-chat-log")
        assert resp.status_code == 422


class TestMissingProviderPackage:
    def test_a_missing_sdk_package_is_a_graceful_200_not_a_500(self, client, db, sample_identity, sample_project):
        """ADR-0103, same bug as the internal assistant's: get_provider(db) ran before
        this endpoint's own try/except too."""
        from app.services import llm_settings

        llm_settings.update(db, {"provider": "openai", "api_key": "sk-test"})
        with patch.dict("sys.modules", {"openai": None}):
            resp = _chat(client, sample_identity.share_token)
        assert resp.status_code == 200
        assert "openai package not installed" in resp.text


class TestDecisionsReachTheVisitorsAssistant:
    """ADR-0120 put decisions on the share page; ADR-0098 means the assistant gets them free.

    Worth asserting anyway rather than resting on ``TestScopedContext``: that test proves
    the prompt equals the payload, and this one proves the payload is worth having — a
    visitor asking "why is it built this way" now has something to be answered from.
    """

    def test_a_decision_is_in_the_prompt_the_visitor_is_answered_from(self, client, db, sample_project):
        from app.services import graph

        graph.create_decision(db, sample_project.id, name="Use PostgreSQL", decision_status="accepted")
        db.commit()

        fake = _RecordingProvider()
        with patch("app.routers.share.get_provider", return_value=fake):
            resp = _chat(client, sample_project.share_token, "why postgres?")
        assert resp.status_code == 200
        assert "Use PostgreSQL" in fake.calls[0]["system"]
