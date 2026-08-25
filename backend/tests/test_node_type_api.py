"""The type registry has two doors and one set of rules (ADR-0079).

Creating a *layer* — an `organization` above projects — was possible from the SPA and
from nothing else: the registry lived only under the internal `/api`, which a browser
session reaches and an API key does not. `/api/v1` could create nodes of a type but
never the type, and could not even list which types existed, while `type` is required
on every node write.

The guard tests matter more than the happy path here. Two doors onto one registry is
how a rule comes to hold on one surface and be missing on the other, so each refusal is
asserted through *both* — the internal router and the external one — against the same
database.
"""

import hashlib

import pytest

from app.models import ApiKey, NodeType
from app.services import graph
from tests.factories import make_project


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
def admin_key(db):
    return _key(db, "types_admin", ["read", "write", "admin"])


@pytest.fixture()
def read_key(db):
    return _key(db, "types_read", ["read"])


@pytest.fixture()
def write_key(db):
    return _key(db, "types_write", ["read", "write"])


class TestALayerCanBeCreatedThroughTheApi:
    """The actual gap: an organization level was UI-only."""

    def test_creating_a_container_layer_and_filing_a_project_under_it(self, client, db, admin_key):
        created = client.post(
            "/api/v1/node-types",
            json={"key": "organization", "label": "Organization", "roles": ["container"]},
            headers={"X-API-Key": admin_key},
        )
        assert created.status_code == 201
        assert created.json()["roles"] == ["container"]

        org = client.post(
            "/api/v1/nodes",
            json={"type": "organization", "title": "Callback Network"},
            headers={"X-API-Key": admin_key},
        ).json()
        project = make_project(db, name="Shard")
        db.commit()

        # The point of the container role: it may parent (ADR-0078).
        filed = client.post(
            f"/api/v1/nodes/{org['id']}/edges",
            json={"target_id": project.id, "rel_type": "contains"},
            headers={"X-API-Key": admin_key},
        )
        assert filed.status_code == 201

    def test_the_registry_is_listed_so_type_is_not_a_guess(self, client, db, read_key):
        body = client.get("/api/v1/node-types", headers={"X-API-Key": read_key}).json()

        by_key = {t["key"]: t for t in body}
        assert {"project", "task", "identity", "goal"} <= set(by_key)
        assert by_key["project"]["roles"] == ["container", "shareable", "subscribable"]
        assert by_key["task"]["usage_count"] == 0

    def test_agent_context_carries_the_same_vocabulary(self, client, db, read_key):
        conventions = client.get("/api/v1/agent-context", headers={"X-API-Key": read_key}).json()["conventions"]

        assert {t["key"] for t in conventions["node_types"]} >= {"project", "task"}
        assert "relations" in conventions


class TestWritingATypeNeedsAdmin:
    """A type is the shape other data is stored in — `write` is not enough."""

    @pytest.mark.parametrize(
        "method,path,payload",
        [
            ("post", "/api/v1/node-types", {"key": "org2", "label": "Org"}),
            ("patch", "/api/v1/node-types/task", {"label": "Renamed"}),
            ("delete", "/api/v1/node-types/task", None),
        ],
    )
    def test_a_write_scope_key_is_refused(self, client, db, write_key, method, path, payload):
        call = getattr(client, method)
        resp = (
            call(path, json=payload, headers={"X-API-Key": write_key})
            if payload
            else call(path, headers={"X-API-Key": write_key})
        )

        assert resp.status_code == 403

    def test_an_anonymous_caller_is_refused(self, client, db):
        """Matches every other /api/v1 route: a missing header is 422, a bad key 401.

        Asserted as the two separate codes rather than "not 200" so that a future
        endpoint answering an unauthenticated read with data fails here.
        """
        assert client.get("/api/v1/node-types").status_code == 422
        assert client.get("/api/v1/node-types", headers={"X-API-Key": "nope"}).status_code == 401


class TestBothDoorsRefuseTheSameThings:
    """One implementation, asserted through both surfaces against one database."""

    def _both(self, client, admin_key, method, internal, external, payload=None):
        call = getattr(client, method)
        kwargs = {"json": payload} if payload is not None else {}
        a = call(internal, **kwargs)
        b = call(external, headers={"X-API-Key": admin_key}, **kwargs)
        return a, b

    def test_a_builtin_type_cannot_be_deleted_through_either(self, client, db, admin_key):
        a, b = self._both(client, admin_key, "delete", "/api/graph-types/nodes/task", "/api/v1/node-types/task")

        assert a.status_code == b.status_code == 400
        assert a.json()["detail"] == b.json()["detail"]
        assert db.get(NodeType, "task") is not None

    def test_a_builtin_role_cannot_be_changed_through_either(self, client, db, admin_key):
        a, b = self._both(
            client,
            admin_key,
            "patch",
            "/api/graph-types/nodes/project",
            "/api/v1/node-types/project",
            payload={"roles": ["shareable"]},
        )

        assert a.status_code == b.status_code == 400
        assert a.json()["detail"] == b.json()["detail"]
        assert graph.has_role(db, "project", graph.ROLE_CONTAINER)

    def test_a_type_in_use_cannot_be_deleted_through_either(self, client, db, admin_key):
        db.add(NodeType(key="area", label="Area", roles=[graph.ROLE_CONTAINER]))
        db.flush()
        graph.create_node(db, "area", title="Platform Group")
        db.commit()

        a, b = self._both(client, admin_key, "delete", "/api/graph-types/nodes/area", "/api/v1/node-types/area")

        assert a.status_code == b.status_code == 409
        assert a.json()["detail"] == b.json()["detail"]

    def test_a_feature_owned_data_key_cannot_be_declared_through_either(self, client, db, admin_key):
        """ADR-0074's managed-key guard lives on the schema, so it must hold on both."""
        payload = {
            "key": "leaky",
            "label": "Leaky",
            "fields": [{"key": "share_token", "label": "Token", "kind": "text"}],
        }

        a, b = self._both(client, admin_key, "post", "/api/graph-types/nodes", "/api/v1/node-types", payload=payload)

        assert a.status_code == b.status_code == 422
        assert db.get(NodeType, "leaky") is None

    def test_a_duplicate_key_is_a_conflict_on_both(self, client, db, admin_key):
        payload = {"key": "topic", "label": "Topic"}
        client.post("/api/v1/node-types", json=payload, headers={"X-API-Key": admin_key})

        a, b = self._both(client, admin_key, "post", "/api/graph-types/nodes", "/api/v1/node-types", payload=payload)

        assert a.status_code == b.status_code == 409
        assert a.json()["detail"] == b.json()["detail"]
