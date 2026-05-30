from app.models import Label


def test_list_decisions_empty(client):
    r = client.get("/decisions")
    assert r.status_code == 200
    assert r.json() == []


def test_list_decisions(client, db, sample_project):
    l = Label(
        project_id=sample_project.id,
        name="Use PostgreSQL",
        color="#5e6ad2",
        type="decision",
        decision_status="accepted",
        description="We chose PostgreSQL for reliability.",
    )
    db.add(l)
    db.commit()
    db.refresh(l)

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

    db.add(Label(
        project_id=sample_project.id,
        name="Decision A",
        color="#5e6ad2",
        type="decision",
        decision_status="proposed",
    ))
    db.add(Label(
        project_id=p2.id,
        name="Decision B",
        color="#5e6ad2",
        type="decision",
        decision_status="proposed",
    ))
    db.commit()

    r = client.get("/decisions", params={"project_id": sample_project.id})
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["name"] == "Decision A"


def test_list_decisions_filter_status(client, db, sample_project):
    db.add(Label(
        project_id=sample_project.id,
        name="Accepted decision",
        color="#5e6ad2",
        type="decision",
        decision_status="accepted",
    ))
    db.add(Label(
        project_id=sample_project.id,
        name="Proposed decision",
        color="#5e6ad2",
        type="decision",
        decision_status="proposed",
    ))
    db.commit()

    r = client.get("/decisions", params={"status": "accepted"})
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["name"] == "Accepted decision"


def test_get_decision(client, db, sample_project):
    l = Label(
        project_id=sample_project.id,
        name="Use Redis",
        color="#5e6ad2",
        type="decision",
        decision_status="accepted",
        description="Chosen for caching layer.",
    )
    db.add(l)
    db.commit()
    db.refresh(l)

    r = client.get(f"/decisions/{l.id}")
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == l.id
    assert data["name"] == "Use Redis"
    assert data["decision_status"] == "accepted"


def test_get_decision_not_found(client):
    r = client.get("/decisions/nonexistent-id")
    assert r.status_code == 404


def test_export_decision(client, db, sample_project):
    l = Label(
        project_id=sample_project.id,
        name="Use PostgreSQL",
        color="#5e6ad2",
        type="decision",
        decision_status="accepted",
        description="We chose PostgreSQL for reliability.",
    )
    db.add(l)
    db.commit()
    db.refresh(l)

    r = client.get(f"/decisions/{l.id}/export")
    assert r.status_code == 200
    assert "text/markdown" in r.headers["content-type"]

    body = r.text
    assert "# Use PostgreSQL" in body
    assert "## Status" in body
    assert "Accepted" in body
    assert "We chose PostgreSQL for reliability." in body
