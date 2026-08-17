"""An identity is a place work can live (ADR-0095).

ADR-0040 declared ``identity`` as ``{shareable, subscribable}`` — a persona you hang
ownership on — and gave the container role to ``organization``. Production disagreed:
the user's hierarchy is ``organization -> identity -> project``, stored as ``contains``
edges, six of which the ADR-0078 endpoint rule would refuse to create today. The data was
built before the rule and nothing broke, because Focus walks ``contains`` and ``owns``
alike — but the structure on screen was one the app could no longer rebuild.

Granting the role is one string in the registry. What it *changes* is behaviour, so this
file pins the three consequences that are worth knowing about, including the destructive
one: a container's teardown reaches the tasks inside it.
"""

import pytest

from app.models import Node
from app.services import ancestry, graph
from tests.factories import make_task


@pytest.fixture()
def identity(db):
    ident = graph.create_identity(db, name="Pipeline developer", color="#f472b6")
    db.commit()
    return db.get(Node, ident.id)


def test_a_project_can_be_filed_under_an_identity(client, db, identity):
    project = client.post("/api/nodes", json={"type": "project", "title": "comfyui-dispatch"}).json()

    resp = client.post(f"/api/nodes/{identity.id}/edges", json={"target_id": project["id"], "rel_type": "contains"})

    assert resp.status_code == 201
    trails = ancestry.ancestry_for(db, [project["id"]])[project["id"]].trails
    assert [[r.title for r in trail] for trail in trails] == [["Pipeline developer"]]


def test_ownership_is_still_a_different_statement(db, identity):
    """Both relations are legal for this pair now, and they do not mean the same thing:
    only ``contains`` carries the rollups (ADR-0078 keeps the two axes apart)."""
    project = graph.create_project(db, name="Shard")
    graph.add_edge(db, identity.id, project.id, graph.REL_OWNS)
    db.commit()

    entry = ancestry.ancestry_for(db, [project.id])[project.id]
    assert entry.trails == []
    assert [r.title for r in entry.owners] == ["Pipeline developer"]
    assert graph.identity_ids_for_project(db, project.id) == [identity.id]


def test_deleting_an_identity_leaves_the_projects_inside_it_standing(client, db, identity):
    project = graph.create_project(db, name="wiki")
    graph.add_edge(db, identity.id, project.id, graph.REL_CONTAINS)
    db.commit()

    assert client.delete(f"/api/nodes/{identity.id}").status_code == 204

    assert db.get(Node, project.id) is not None
    assert ancestry.ancestry_for(db, [project.id])[project.id].trails == []


def test_deleting_an_identity_takes_the_tasks_filed_directly_under_it(client, db, identity):
    """The container teardown (ADR-0043) now applies to identities too. Nothing files a
    task straight under an identity today — but the day something does, this is what
    deleting the identity means, and it should be a decision rather than a surprise."""
    task = make_task(db, project_id=identity.id, title="Personal errand")
    db.commit()
    task_id = task.id

    assert client.delete(f"/api/nodes/{identity.id}").status_code == 204

    assert db.get(Node, task_id) is None


def test_a_task_filed_under_two_containers_survives_one_of_them(client, db, identity):
    project = graph.create_project(db, name="wiki")
    task = make_task(db, project_id=project.id, title="Write the page")
    graph.add_edge(db, identity.id, task.id, graph.REL_CONTAINS)
    db.commit()
    task_id = task.id

    assert client.delete(f"/api/nodes/{identity.id}").status_code == 204

    assert db.get(Node, task_id) is not None
    assert graph.member_project_ids(db, task_id) == [project.id]
