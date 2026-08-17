"""A node knows where it lives, through both doors (ADR-0094).

The graph has been able to answer "what is above this node" since ADR-0033 — nothing
asked it. These tests pin the answer's *shape*, because that shape is what the strip in
the UI renders: root-first trails, one per parent, with ownership kept on its own axis.

The multi-parent case is not exotic here. Production stores 16 nodes with two parents
(a subtask filed under both its project and its parent task, a project belonging to two
identities), and a trail list that silently returned only the first one would look right
in every screenshot.
"""

import hashlib

import pytest

from app.models import ApiKey, Node, NodeType
from app.services import ancestry, graph
from tests.factories import make_task


@pytest.fixture()
def org_type(db):
    """A user's own layer above project: no roles, so it nests freely (ADR-0078)."""
    db.add(NodeType(key="organization", label="Organization", roles=[], color="#818cf8"))
    db.commit()
    return "organization"


def _node(db, type_key, title, **data):
    node = Node(type=type_key, title=title, data=data or None)
    db.add(node)
    db.flush()
    return node


def _read_key(db):
    raw = "tdp_test_ancestry_read"
    db.add(
        ApiKey(
            name="anc_read",
            key=raw,
            key_hash=hashlib.sha256(raw.encode()).hexdigest(),
            key_last4=raw[-4:],
            scopes=["read"],
            active=True,
        )
    )
    db.commit()
    return raw


def test_a_trail_reads_from_the_root_down_to_the_direct_parent(db, org_type):
    org = _node(db, org_type, "CGCG", color="#ff8800")
    project = graph.create_project(db, name="comfyui-dispatch")
    graph.add_edge(db, org.id, project.id, graph.REL_CONTAINS)
    task = make_task(db, project_id=project.id, title="Ship it")
    sub = make_task(db, project_id=project.id, parent_id=task.id, title="Half of it")
    db.commit()

    out = ancestry.ancestry_for(db, [sub.id])[sub.id]
    # Two parents in the data (project and parent task), so two trails — and each one is
    # read outermost-first, which is the order a breadcrumb is spoken in. Trails follow
    # the parent edges in (position, created_at) order, the same pick compat
    # ``project_id`` makes, so the strip does not reshuffle itself between reads.
    assert [[r.title for r in trail] for trail in out.trails] == [
        ["CGCG", "comfyui-dispatch"],
        ["CGCG", "comfyui-dispatch", "Ship it"],
    ]
    assert [r.type_label for r in out.trails[1]] == ["Organization", "Project", "Task"]
    # A node's own colour wins over its type's, so an identity keeps its avatar colour.
    assert out.trails[0][0].color == "#ff8800"
    assert out.truncated is False


def test_a_node_with_two_parents_gets_two_trails(db):
    left = graph.create_project(db, name="Left")
    right = graph.create_project(db, name="Right")
    task = make_task(db, project_id=left.id, title="Shared")
    graph.add_edge(db, right.id, task.id, graph.REL_CONTAINS)
    db.commit()

    out = ancestry.ancestry_for(db, [task.id])[task.id]
    assert sorted(trail[-1].title for trail in out.trails) == ["Left", "Right"]


def test_ownership_is_a_separate_axis_from_containment(db, sample_project, sample_identity):
    """``owns`` says whose it is; it must not appear as a containment level (ADR-0078)."""
    out = ancestry.ancestry_for(db, [sample_project.id])[sample_project.id]
    assert out.trails == []
    assert [r.title for r in out.owners] == ["Test User"]
    assert out.owners[0].type == "identity"


def test_an_id_that_resolves_to_nothing_is_absent_rather_than_fatal(db, sample_project):
    out = ancestry.ancestry_for(db, [sample_project.id, "no-such-node"])
    assert set(out) == {sample_project.id}


def test_both_doors_return_the_same_ancestry(client, db, org_type):
    org = _node(db, org_type, "CallbackNetwork")
    project = graph.create_project(db, name="n8n")
    graph.add_edge(db, org.id, project.id, graph.REL_CONTAINS)
    db.commit()
    key = _read_key(db)

    internal = client.get(f"/api/graph/ancestry?ids={project.id}")
    external = client.get(f"/api/v1/graph/ancestry?ids={project.id}", headers={"X-API-Key": key})
    assert internal.status_code == external.status_code == 200
    assert internal.json() == external.json()
    assert internal.json()[project.id]["trails"] == [
        [
            {
                "id": org.id,
                "type": "organization",
                "type_label": "Organization",
                "title": "CallbackNetwork",
                "color": "#818cf8",
            }
        ]
    ]


def test_a_project_scoped_key_is_not_told_what_is_above_its_project(client, db, org_type):
    """The subtree endpoint already filters child titles by access; ancestors are the
    same secret in the other direction — the name of the org a project sits under."""
    org = _node(db, org_type, "Secret Org")
    mine = graph.create_project(db, name="Mine")
    graph.add_edge(db, org.id, mine.id, graph.REL_CONTAINS)
    task = make_task(db, project_id=mine.id, title="In scope")
    raw = "tdp_test_ancestry_scoped"
    db.add(
        ApiKey(
            name="anc_scoped",
            key=raw,
            key_hash=hashlib.sha256(raw.encode()).hexdigest(),
            key_last4=raw[-4:],
            scopes=["read"],
            project_id=mine.id,
            active=True,
        )
    )
    db.commit()

    body = client.get(
        f"/api/v1/graph/ancestry?ids={task.id},{mine.id}",
        headers={"X-API-Key": raw},
    ).json()
    assert [[r["title"] for r in trail] for trail in body[task.id]["trails"]] == [["Mine"]]
    assert body[mine.id]["trails"] == []
