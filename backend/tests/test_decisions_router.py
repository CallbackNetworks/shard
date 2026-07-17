from app.services import graph


def _make_decision(db, project_id, name, *, decision_status="proposed", description=None):
    label = graph.create_label(
        db,
        project_id,
        name=name,
        color="#5e6ad2",
        type="decision",
        decision_status=decision_status,
        description=description,
    )
    db.commit()
    return label


def test_list_decisions_empty(client):
    r = client.get("/decisions")
    assert r.status_code == 200
    assert r.json() == []


def test_list_decisions(client, db, sample_project):
    _make_decision(
        db,
        sample_project.id,
        "Use PostgreSQL",
        decision_status="accepted",
        description="We chose PostgreSQL for reliability.",
    )

    r = client.get("/decisions")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["name"] == "Use PostgreSQL"
    assert data[0]["type"] == "decision"
    assert data[0]["decision_status"] == "accepted"


def test_list_decisions_filter_project(client, db, sample_project):
    # Create a second project
    from app.models import Project

    p2 = Project(name="Other Project")
    db.add(p2)
    db.flush()

    _make_decision(db, sample_project.id, "Decision A")
    _make_decision(db, p2.id, "Decision B")

    r = client.get("/decisions", params={"project_id": sample_project.id})
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["name"] == "Decision A"


def test_list_decisions_filter_status(client, db, sample_project):
    _make_decision(db, sample_project.id, "Accepted decision", decision_status="accepted")
    _make_decision(db, sample_project.id, "Proposed decision", decision_status="proposed")

    r = client.get("/decisions", params={"status": "accepted"})
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["name"] == "Accepted decision"


def test_get_decision(client, db, sample_project):
    label = _make_decision(
        db,
        sample_project.id,
        "Use Redis",
        decision_status="accepted",
        description="Chosen for caching layer.",
    )

    r = client.get(f"/decisions/{label.id}")
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == label.id
    assert data["name"] == "Use Redis"
    assert data["decision_status"] == "accepted"


def test_get_decision_not_found(client):
    r = client.get("/decisions/nonexistent-id")
    assert r.status_code == 404


def test_export_decision(client, db, sample_project):
    label = _make_decision(
        db,
        sample_project.id,
        "Use PostgreSQL",
        decision_status="accepted",
        description="We chose PostgreSQL for reliability.",
    )

    r = client.get(f"/decisions/{label.id}/export")
    assert r.status_code == 200
    assert "text/markdown" in r.headers["content-type"]

    body = r.text
    assert "# Use PostgreSQL" in body
    assert "## Status" in body
    assert "Accepted" in body
    assert "We chose PostgreSQL for reliability." in body
