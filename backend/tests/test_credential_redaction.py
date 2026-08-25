"""Credentials do not leave the server (ADR-0059).

A node's ``data`` is free-form JSON, so nothing in the OpenAPI contract ever described
what lives inside it — and what lives inside it includes a share token, a share PIN hash,
a CI callback token and a webhook signing secret. ``TaskOut`` served the last two as
first-class fields besides.

That mattered because ``/webhook/callback/{token}`` is deliberately unauthenticated and
skips its signature check when a task has no ``webhook_secret``. A ``read``-scope key —
the least privilege the system offers — could list nodes, collect every callback token,
and post task state changes. These tests pin the boundary that closes it.
"""

import hashlib

import pytest

from app.models import ApiKey
from app.services import graph, node_data
from tests.factories import make_project, make_task


def _key(db, name, scopes):
    raw = f"tdp_test_{name}"
    db.add(
        ApiKey(
            name=name,
            key_hash=hashlib.sha256(raw.encode()).hexdigest(),
            key_last4=raw[-4:],
            scopes=scopes,
            active=True,
        )
    )
    db.commit()
    return raw


@pytest.fixture()
def task_with_secrets(db):
    project = make_project(db, name="Redaction")
    task = make_task(db, project_id=project.id, title="Build")
    graph.update_node(db, task.id, webhook_secret="s3cret", callback_token="cb-token-abc")
    db.commit()
    return project, task


class TestNeverServed:
    """Two values nobody has a reason to read back, on any route, at any scope."""

    def test_the_signing_secret_never_appears_in_a_task_payload(self, client, db, task_with_secrets):
        project, _ = task_with_secrets
        admin = _key(db, "never_admin", ["read", "write", "admin"])

        internal = client.get(f"/api/projects/{project.id}").json()["tasks"][0]
        external = client.get(f"/api/v1/projects/{project.id}/tasks", headers={"X-API-Key": admin}).json()[0]

        for payload in (internal, external):
            assert "webhook_secret" not in payload
            # Whether one is set is worth knowing: an unsigned callback is accepted from
            # anyone holding the token, and signatures are still optional.
            assert payload["webhook_secret_set"] is True

    def test_the_pin_hash_becomes_a_boolean(self, client, db):
        node = graph.create_node(db, "project", title="Shared")
        graph.update_node(db, node.id, share_pin_hash="salt:deadbeef")
        db.commit()

        data = client.get(f"/api/nodes/{node.id}").json()["data"]

        # The hash is a salted single-round SHA-256 of a short numeric PIN, which is to
        # say it is the PIN. The bespoke identity router always knew this; the generic
        # node surface did not inherit it.
        assert "share_pin_hash" not in data
        assert data["share_pin_set"] is True

    def test_a_node_without_a_pin_is_not_given_a_meaningless_flag(self, client, db):
        node = graph.create_node(db, "project", title="Plain")
        db.commit()
        assert "share_pin_set" not in (client.get(f"/api/nodes/{node.id}").json()["data"] or {})

    def test_the_internal_graph_map_redacts_too(self, client, db, task_with_secrets):
        """The one node read that assembles its own payload instead of using ``NodeOut``.

        It therefore inherited none of the redaction, and was still serving PIN hashes
        and signing secrets to the structure map. The frontend had already been changed
        to read ``share_pin_set``, which this endpoint did not produce.
        """
        node = graph.create_node(db, "project", title="Mapped")
        graph.update_node(db, node.id, share_pin_hash="salt:deadbeef")
        db.commit()

        nodes = client.get("/api/graph/map?include=data").json()["nodes"]
        blobs = [n.get("data") or {} for n in nodes]

        assert [b for b in blobs if "share_pin_hash" in b or "webhook_secret" in b] == []
        assert any(b.get("share_pin_set") for b in blobs)
        # The owner's own session still gets the tokens the UI is built from.
        assert any(b.get("callback_token") for b in blobs)


class TestTokensFollowAuthority:
    """A share token and a callback token let the holder act, so they track scope."""

    def test_a_read_key_collects_no_tokens_from_the_node_list(self, client, db, task_with_secrets):
        read = _key(db, "tok_read", ["read"])

        rows = client.get("/api/v1/nodes?include=data&limit=200", headers={"X-API-Key": read}).json()

        found = [k for row in rows for k in node_data.TOKENS if (row.get("data") or {}).get(k)]
        assert found == [], f"a read-scope key harvested {found}"

    def test_a_read_key_collects_no_tokens_from_the_task_list(self, client, db, task_with_secrets):
        project, _ = task_with_secrets
        read = _key(db, "tok_read2", ["read"])

        rows = client.get(f"/api/v1/projects/{project.id}/tasks", headers={"X-API-Key": read}).json()

        assert [r for r in rows if r.get("callback_token")] == []

    def test_a_write_key_is_no_better(self, client, db, task_with_secrets):
        project, _ = task_with_secrets
        write = _key(db, "tok_write", ["read", "write"])

        rows = client.get(f"/api/v1/projects/{project.id}/tasks", headers={"X-API-Key": write}).json()

        # Writing through the API is not the same authority as holding the credential that
        # bypasses it, so `write` does not unlock these either.
        assert [r for r in rows if r.get("callback_token")] == []

    def test_an_admin_key_still_gets_them(self, client, db, task_with_secrets):
        project, _ = task_with_secrets
        admin = _key(db, "tok_admin", ["read", "write", "admin"])

        rows = client.get(f"/api/v1/projects/{project.id}/tasks", headers={"X-API-Key": admin}).json()

        # Otherwise an agent could never configure a CI callback, which is the feature.
        assert [r for r in rows if r.get("callback_token")] != []

    def test_the_graph_map_is_redacted_too(self, client, db, task_with_secrets):
        read = _key(db, "tok_map", ["read"])

        payload = client.get("/api/v1/graph/map?include=data", headers={"X-API-Key": read}).json()

        found = [k for n in payload["nodes"] for k in node_data.TOKENS if (n.get("data") or {}).get(k)]
        assert found == []

    def test_the_owner_session_keeps_what_the_ui_needs(self, client, db, task_with_secrets):
        project, _ = task_with_secrets

        task = client.get(f"/api/projects/{project.id}").json()["tasks"][0]

        # The internal API is the owner's own session; the UI offers a "copy webhook URL"
        # button built from this. Redacting here would break a feature without closing
        # anything — the owner already holds every credential in the database.
        assert task["callback_token"]


class TestTheContractItself:
    def test_no_response_schema_advertises_a_credential(self, client):
        """A field that is never served should not be documented as if it were.

        Cheap to check and hard to bypass: this reads the generated OpenAPI document, so
        a new schema that re-exposes one of these fails here without anyone remembering
        to write a test for it.
        """
        spec = client.get("/openapi.json").json()
        offenders = []

        def walk(node, path):
            if isinstance(node, dict):
                for key, value in node.items():
                    if key == "properties" and isinstance(value, dict):
                        offenders.extend(f"{path}.{p}" for p in value if p in node_data.NEVER_SERVED)
                    walk(value, f"{path}.{key}")
            elif isinstance(node, list):
                for i, item in enumerate(node):
                    walk(item, f"{path}[{i}]")

        walk(spec.get("components", {}).get("schemas", {}), "schemas")
        assert offenders == [], f"credential fields advertised in the API contract: {offenders}"


class TestPublicDataUnit:
    def test_a_derived_flag_cannot_be_written_back(self):
        # A client that PATCHes back a node it just read would otherwise persist the
        # read-only projection as a junk key.
        assert node_data.strip_derived({"share_pin_set": True, "color": "red"}) == {"color": "red"}

    def test_stripping_reaches_into_nested_payloads(self):
        payload = {"nodes": [{"data": {"callback_token": "x", "assignee": "me"}}]}
        assert node_data.strip_tokens(payload) == {"nodes": [{"data": {"assignee": "me"}}]}

    def test_an_empty_blob_is_left_alone(self):
        assert node_data.public_data(None) is None
        assert node_data.public_data({}) == {}
