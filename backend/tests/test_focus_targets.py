"""Focus can narrow by any node that reaches projects, not just identity (ADR-0081).

``/api/focus-targets`` returns every identity plus every non-project container-role
node, each with the project ids reachable from it via ``contains``/``owns``.
"""

from tests.factories import make_project


def _create_org(client):
    client.post("/api/graph-types/nodes", json={"key": "organization", "label": "Organization", "roles": ["container"]})
    return client.post("/api/nodes", json={"type": "organization", "title": "CGCG"}).json()


def test_identity_only_target_sees_its_own_projects(client, sample_identity, db):
    project = make_project(db, name="Owned")
    db.commit()
    client.post(f"/api/nodes/{sample_identity.id}/edges", json={"target_id": project.id, "rel_type": "owns"})

    targets = client.get("/api/focus-targets").json()
    identity_target = next(t for t in targets if t["id"] == sample_identity.id)
    assert identity_target["type"] == "identity"
    assert identity_target["project_ids"] == [project.id]
    assert identity_target["project_count"] == 1


def test_organization_reaches_projects_transitively_through_identity(client, sample_identity, db):
    project = make_project(db, name="Under Org")
    db.commit()
    client.post(f"/api/nodes/{sample_identity.id}/edges", json={"target_id": project.id, "rel_type": "owns"})

    org = _create_org(client)
    client.post(f"/api/nodes/{org['id']}/edges", json={"target_id": sample_identity.id, "rel_type": "contains"})

    targets = client.get("/api/focus-targets").json()
    org_target = next(t for t in targets if t["id"] == org["id"])
    assert org_target["type"] == "organization"
    assert org_target["type_label"] == "Organization"
    assert org_target["project_ids"] == [project.id]

    # The organization is a focus candidate itself, distinct from the identity beneath it.
    identity_target = next(t for t in targets if t["id"] == sample_identity.id)
    assert identity_target["project_ids"] == [project.id]


def test_organization_can_also_contain_a_project_directly(client, db):
    project = make_project(db, name="Directly Filed")
    db.commit()
    org = _create_org(client)
    client.post(f"/api/nodes/{org['id']}/edges", json={"target_id": project.id, "rel_type": "contains"})

    targets = client.get("/api/focus-targets").json()
    org_target = next(t for t in targets if t["id"] == org["id"])
    assert org_target["project_ids"] == [project.id]


def test_unowned_project_appears_under_no_focus_target(client, sample_identity, db):
    make_project(db, name="Unowned")
    db.commit()

    targets = client.get("/api/focus-targets").json()
    identity_target = next(t for t in targets if t["id"] == sample_identity.id)
    assert identity_target["project_ids"] == []


def test_project_type_itself_is_never_a_focus_target(client, sample_project):
    targets = client.get("/api/focus-targets").json()
    assert all(t["type"] != "project" for t in targets)
