"""Tests for the node/edge type registry REST API (ADR-0033 Phase A)."""

from app.services import graph


def test_list_node_types_includes_builtins(client):
    r = client.get("/api/graph-types/nodes")
    assert r.status_code == 200
    keys = {t["key"] for t in r.json()}
    assert {graph.NODE_TASK, graph.NODE_PROJECT} <= keys
    task = next(t for t in r.json() if t["key"] == graph.NODE_TASK)
    assert task["is_builtin"] is True


def test_list_edge_types_includes_builtins(client):
    r = client.get("/api/graph-types/edges")
    assert r.status_code == 200
    contains = next(t for t in r.json() if t["key"] == graph.REL_CONTAINS)
    assert contains["is_builtin"] is True
    assert contains["is_containment"] is True


def test_type_listings_carry_usage_counts(client):
    """ADR-0037: usage_count lets the UI show why a delete would 409."""
    client.post("/api/graph-types/nodes", json={"key": "topic", "label": "Topic"})
    client.post("/api/nodes", json={"type": "topic", "title": "A"})
    a = client.post("/api/nodes", json={"type": "topic", "title": "B"}).json()
    b = client.post("/api/nodes", json={"type": "topic", "title": "C"}).json()
    client.post(f"/api/nodes/{a['id']}/edges", json={"target_id": b["id"], "rel_type": "contains"})

    topic = next(t for t in client.get("/api/graph-types/nodes").json() if t["key"] == "topic")
    assert topic["usage_count"] == 3
    contains = next(t for t in client.get("/api/graph-types/edges").json() if t["key"] == graph.REL_CONTAINS)
    assert contains["usage_count"] >= 1


def test_create_custom_node_type(client):
    r = client.post("/api/graph-types/nodes", json={"key": "Topic", "label": "Topic", "color": "#abcdef"})
    assert r.status_code == 201
    body = r.json()
    assert body["key"] == "topic"  # normalized to lowercase
    assert body["is_builtin"] is False

    # It now appears in the list.
    keys = {t["key"] for t in client.get("/api/graph-types/nodes").json()}
    assert "topic" in keys


def test_create_node_type_rejects_bad_key(client):
    r = client.post("/api/graph-types/nodes", json={"key": "has space", "label": "X"})
    assert r.status_code == 422


def test_create_node_type_conflict(client):
    client.post("/api/graph-types/nodes", json={"key": "topic", "label": "Topic"})
    r = client.post("/api/graph-types/nodes", json={"key": "topic", "label": "Again"})
    assert r.status_code == 409


def test_update_node_type(client):
    client.post("/api/graph-types/nodes", json={"key": "topic", "label": "Topic"})
    r = client.patch("/api/graph-types/nodes/topic", json={"label": "Subject"})
    assert r.status_code == 200
    assert r.json()["label"] == "Subject"


def test_cannot_delete_builtin_node_type(client):
    r = client.delete(f"/api/graph-types/nodes/{graph.NODE_TASK}")
    assert r.status_code == 400


def test_delete_custom_node_type(client):
    client.post("/api/graph-types/nodes", json={"key": "topic", "label": "Topic"})
    r = client.delete("/api/graph-types/nodes/topic")
    assert r.status_code == 204
    assert "topic" not in {t["key"] for t in client.get("/api/graph-types/nodes").json()}


def test_delete_node_type_in_use_conflict(client, db):
    client.post("/api/graph-types/nodes", json={"key": "topic", "label": "Topic"})
    graph.create_node(db, "topic", title="My topic")
    db.commit()
    r = client.delete("/api/graph-types/nodes/topic")
    assert r.status_code == 409


def test_create_custom_container_type(client):
    # ADR-0034/0040: the container role is user-settable on custom types via roles.
    r = client.post("/api/graph-types/nodes", json={"key": "workspace", "label": "Workspace", "roles": ["container"]})
    assert r.status_code == 201
    assert r.json()["roles"] == ["container"]
    assert graph.NODE_PROJECT not in (r.json()["key"],)  # sanity: it's the custom key
    listed = next(t for t in client.get("/api/graph-types/nodes").json() if t["key"] == "workspace")
    assert "container" in listed["roles"]


def test_toggle_container_role_on_custom_type(client):
    client.post("/api/graph-types/nodes", json={"key": "workspace", "label": "Workspace"})
    r = client.patch("/api/graph-types/nodes/workspace", json={"roles": ["container"]})
    assert r.status_code == 200
    assert r.json()["roles"] == ["container"]


def test_cannot_change_role_of_builtin_type(client):
    # Dropping project's container role would break compat project_ids (ADR-0034).
    r = client.patch(f"/api/graph-types/nodes/{graph.NODE_PROJECT}", json={"roles": ["shareable"]})
    assert r.status_code == 400
    # And it stays a container.
    proj = next(t for t in client.get("/api/graph-types/nodes").json() if t["key"] == graph.NODE_PROJECT)
    assert "container" in proj["roles"]


def test_custom_type_can_opt_into_capabilities(client):
    # ADR-0039/0040: shareable/subscribable roles are settable on a custom type, so a
    # user "topic" gets the same share-facade / iCal capability as identity.
    r = client.post(
        "/api/graph-types/nodes",
        json={"key": "topic", "label": "Topic", "roles": ["shareable", "subscribable"]},
    )
    assert r.status_code == 201
    assert set(r.json()["roles"]) == {"shareable", "subscribable"}
    listed = next(t for t in client.get("/api/graph-types/nodes").json() if t["key"] == "topic")
    assert set(listed["roles"]) == {"shareable", "subscribable"}


def test_toggle_capability_on_custom_type(client):
    # Capabilities are set via the roles set on PATCH.
    client.post("/api/graph-types/nodes", json={"key": "topic", "label": "Topic"})
    r = client.patch("/api/graph-types/nodes/topic", json={"roles": ["shareable"]})
    assert r.status_code == 200
    assert r.json()["roles"] == ["shareable"]


def test_custom_container_surfaces_in_container_ids_not_project_ids(client, db, sample_project):
    # End-to-end: a task under a user-defined container appears in container_ids but
    # never leaks into project_ids (ADR-0034), so the frontend won't 404.
    client.post("/api/graph-types/nodes", json={"key": "workspace", "label": "Workspace", "roles": ["container"]})
    ws = graph.create_node(db, "workspace", title="WS")
    task = client.post("/api/nodes", json={"type": "task", "container_id": sample_project.id, "title": "T"}).json()
    graph.add_edge(db, ws.id, task["id"], graph.REL_CONTAINS)
    db.commit()

    got = client.get(f"/api/projects/{sample_project.id}").json()
    enriched = next(t for t in got["tasks"] if t["id"] == task["id"])
    assert enriched["project_ids"] == [sample_project.id]
    assert ws.id not in enriched["project_ids"]
    assert set(enriched["container_ids"]) == {sample_project.id, ws.id}


def test_create_custom_task_like_type(client):
    # ADR-0035/0040: the task role is user-settable on custom types via roles.
    r = client.post("/api/graph-types/nodes", json={"key": "ticket", "label": "Ticket", "roles": ["task"]})
    assert r.status_code == 201
    assert r.json()["roles"] == ["task"]
    listed = next(t for t in client.get("/api/graph-types/nodes").json() if t["key"] == "ticket")
    assert "task" in listed["roles"]


def test_toggle_task_like_role_on_custom_type(client):
    client.post("/api/graph-types/nodes", json={"key": "ticket", "label": "Ticket"})
    r = client.patch("/api/graph-types/nodes/ticket", json={"roles": ["task"]})
    assert r.status_code == 200
    assert r.json()["roles"] == ["task"]


def test_cannot_change_task_like_of_builtin_task(client):
    # Dropping the built-in task's role would break the enrichment pipeline (ADR-0035).
    r = client.patch(f"/api/graph-types/nodes/{graph.NODE_TASK}", json={"roles": []})
    assert r.status_code == 400
    task = next(t for t in client.get("/api/graph-types/nodes").json() if t["key"] == graph.NODE_TASK)
    assert "task" in task["roles"]


def test_create_and_delete_custom_edge_type(client):
    r = client.post("/api/graph-types/edges", json={"key": "blocks", "label": "Blocks"})
    assert r.status_code == 201
    assert r.json()["is_builtin"] is False
    assert client.delete("/api/graph-types/edges/blocks").status_code == 204


def test_cannot_delete_builtin_edge_type(client):
    r = client.delete(f"/api/graph-types/edges/{graph.REL_CONTAINS}")
    assert r.status_code == 400


def test_cannot_change_structural_flags_of_builtin_edge_type(client):
    # Flipping contains' is_containment would collapse the containment pipeline
    # (mirrors the built-in node-type role guard).
    r = client.patch(f"/api/graph-types/edges/{graph.REL_CONTAINS}", json={"is_containment": False})
    assert r.status_code == 400
    contains = next(t for t in client.get("/api/graph-types/edges").json() if t["key"] == graph.REL_CONTAINS)
    assert contains["is_containment"] is True
    # Label stays editable on built-ins.
    r = client.patch(f"/api/graph-types/edges/{graph.REL_CONTAINS}", json={"label": "Contains!"})
    assert r.status_code == 200
    assert r.json()["label"] == "Contains!"


def test_update_structural_flags_of_custom_edge_type(client):
    client.post("/api/graph-types/edges", json={"key": "groups", "label": "Groups"})
    r = client.patch("/api/graph-types/edges/groups", json={"is_containment": True})
    assert r.status_code == 200
    assert r.json()["is_containment"] is True


# ── Field declarations (ADR-0074) ─────────────────────────────────────────────


def test_builtin_types_declare_their_editable_fields(client):
    """A type says which keys of its nodes' ``data`` belong to the user.

    Identity's three are the point of the exercise: colour, avatar and description are
    the only reason it still needed a page of its own.
    """
    types = {t["key"]: t for t in client.get("/api/graph-types/nodes").json()}

    identity = {f["key"]: f["kind"] for f in types[graph.NODE_IDENTITY]["fields"]}
    assert identity == {"title": "text", "color": "color", "avatar": "emoji", "description": "longtext"}

    # Every built-in declares something, and none of them declare machinery.
    from app.services.graph_registry import MANAGED_DATA_KEYS

    for key in (graph.NODE_PROJECT, graph.NODE_TASK, graph.NODE_CYCLE, graph.NODE_GOAL, graph.NODE_LABEL):
        declared = {f["key"] for f in types[key]["fields"]}
        assert declared, f"{key} declares no fields"
        assert not declared & set(MANAGED_DATA_KEYS), f"{key} declares a managed key"


def test_custom_type_can_declare_and_redeclare_fields(client):
    client.post("/api/graph-types/nodes", json={"key": "incident", "label": "Incident"})
    assert client.get("/api/graph-types/nodes").json()

    r = client.patch(
        "/api/graph-types/nodes/incident",
        json={"fields": [{"key": "severity", "label": "Severity", "kind": "text"}]},
    )
    assert r.status_code == 200
    assert [f["key"] for f in r.json()["fields"]] == ["severity"]

    # Declaring replaces the set outright, like roles.
    r = client.patch(
        "/api/graph-types/nodes/incident",
        json={"fields": [{"key": "runbook", "label": "Runbook", "kind": "url"}]},
    )
    assert [f["key"] for f in r.json()["fields"]] == ["runbook"]


def test_a_type_cannot_declare_machinery_as_editable(client):
    """The keys a feature owns are not the user's to fill (ADR-0059, ADR-0060).

    A hand-edited callback_token silently breaks every signed callback; a hand-edited
    share_pin_hash is a lock with a key nobody holds.
    """
    client.post("/api/graph-types/nodes", json={"key": "brief", "label": "Brief"})

    for managed in ("callback_token", "webhook_secret", "share_token", "share_pin_hash"):
        r = client.patch(
            "/api/graph-types/nodes/brief",
            json={"fields": [{"key": managed, "label": "x", "kind": "text"}]},
        )
        assert r.status_code == 422, managed

    assert client.patch("/api/graph-types/nodes/brief", json={"fields": []}).status_code == 200


def test_a_field_kind_must_be_one_the_editor_knows(client):
    client.post("/api/graph-types/nodes", json={"key": "brief", "label": "Brief"})
    r = client.patch(
        "/api/graph-types/nodes/brief",
        json={"fields": [{"key": "severity", "label": "S", "kind": "wizard"}]},
    )
    assert r.status_code == 422


def test_fields_can_be_declared_at_create_time(client):
    r = client.post(
        "/api/graph-types/nodes",
        json={
            "key": "brief",
            "label": "Brief",
            "fields": [{"key": "audience", "label": "Audience", "kind": "text"}],
        },
    )
    assert r.status_code == 201
    assert [f["key"] for f in r.json()["fields"]] == ["audience"]


def test_a_picker_and_its_options_travel_together(client):
    """An enum with no options is a picker with nothing in it (ADR-0056, ADR-0074).

    ``options`` originally shipped alongside a kind list that had no ``enum`` in it, so
    the vocabulary slot existed and nothing could ever use it.
    """
    client.post("/api/graph-types/nodes", json={"key": "brief", "label": "Brief"})

    r = client.patch(
        "/api/graph-types/nodes/brief",
        json={"fields": [{"key": "audience", "label": "Audience", "kind": "enum"}]},
    )
    assert r.status_code == 422

    r = client.patch(
        "/api/graph-types/nodes/brief",
        json={"fields": [{"key": "audience", "label": "Audience", "kind": "text", "options": ["a", "b"]}]},
    )
    assert r.status_code == 422

    r = client.patch(
        "/api/graph-types/nodes/brief",
        json={"fields": [{"key": "audience", "label": "Audience", "kind": "enum", "options": ["a", "b"]}]},
    )
    assert r.status_code == 200
    assert r.json()["fields"][0]["options"] == ["a", "b"]


def test_closed_sets_are_declared_as_pickers_not_text(client):
    """A decision's status vocabulary is fixed (ADR-0118), so it is an enum."""
    types = {t["key"]: t for t in client.get("/api/graph-types/nodes").json()}
    decision = {f["key"]: f for f in types[graph.NODE_DECISION]["fields"]}

    assert decision["decision_status"]["kind"] == "enum"
    # `deprecated` is in the set: the UI has always offered it as a filter and the old
    # declaration did not carry it, so the editor could not set what the filter could find.
    assert set(decision["decision_status"]["options"]) == {
        "proposed",
        "accepted",
        "deprecated",
        "superseded",
    }

    # `source` records which surface created the row — the system's note, not a field.
    assert "source" not in decision


def test_a_label_no_longer_declares_the_decision_convention(client):
    """A label is a label again (ADR-0118).

    While a decision was a label wearing ``data.type="decision"``, the label type declared
    both keys as editable — which meant the generic node editor offered every label a
    picker that would turn it into a decision record none of the decision surfaces knew
    how to find.
    """
    types = {t["key"]: t for t in client.get("/api/graph-types/nodes").json()}
    label = {f["key"] for f in types[graph.NODE_LABEL]["fields"]}

    assert "type" not in label
    assert "decision_status" not in label


def test_a_project_has_its_own_colour(client):
    """Borrowing the first linked identity's colour makes it edge-creation order."""
    types = {t["key"]: t for t in client.get("/api/graph-types/nodes").json()}
    project = {f["key"]: f["kind"] for f in types[graph.NODE_PROJECT]["fields"]}
    assert project["color"] == "color"


def test_a_field_may_live_in_a_column_and_must_name_a_real_one(client):
    """Half a task's editable surface is columns, so a declaration must reach them.

    A column key the writer does not recognise would be routed into ``data`` under the
    same name: the field would look saved and the column would never change.
    """
    types = {t["key"]: t for t in client.get("/api/graph-types/nodes").json()}
    task = {f["key"]: f for f in types[graph.NODE_TASK]["fields"]}

    assert task["title"]["store"] == "column"
    assert task["status"]["store"] == "column"
    assert task["due_date"]["kind"] == "date"
    # The picker takes the engine's own vocabulary, not a second copy of it.
    from app.services.rules_engine import ACTION_VALUE_ENUMS

    assert task["status"]["options"] == list(ACTION_VALUE_ENUMS["set_status"])
    assert task["priority"]["options"] == list(ACTION_VALUE_ENUMS["set_priority"])
    # A key in `data` keeps the default store.
    assert task["assignee"]["store"] == "data"

    client.post("/api/graph-types/nodes", json={"key": "brief", "label": "Brief"})
    r = client.patch(
        "/api/graph-types/nodes/brief",
        json={"fields": [{"key": "severity", "label": "S", "kind": "text", "store": "column"}]},
    )
    assert r.status_code == 422

    r = client.patch(
        "/api/graph-types/nodes/brief",
        json={"fields": [{"key": "status", "label": "Status", "kind": "text", "store": "column"}]},
    )
    assert r.status_code == 200


def test_every_builtin_names_itself_through_the_title_column(client):
    """The name was the last thing every page had to hand-roll a box for."""
    for t in client.get("/api/graph-types/nodes").json():
        if not t["is_builtin"]:
            continue
        title = next((f for f in t["fields"] if f["key"] == "title"), None)
        assert title, f"{t['key']} declares no name field"
        assert title["store"] == "column"
