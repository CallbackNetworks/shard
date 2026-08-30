from app.services import graph


def _make_decision(db, project_id, name, *, decision_status="proposed", description=None):
    decision = graph.create_decision(
        db,
        project_id,
        name=name,
        color="#5e6ad2",
        decision_status=decision_status,
        description=description,
    )
    db.commit()
    return decision


def _read_key(db, raw="tdp_test_decision_read", *, scopes=("read",)):
    import hashlib

    from app.models import ApiKey

    db.add(
        ApiKey(
            name=f"decision_{'_'.join(scopes)}",
            key_hash=hashlib.sha256(raw.encode()).hexdigest(),
            key_last4=raw[-4:],
            scopes=list(scopes),
            active=True,
        )
    )
    db.commit()
    return raw


def test_list_decisions_empty(client):
    r = client.get("/api/decisions")
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

    r = client.get("/api/decisions")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["name"] == "Use PostgreSQL"
    assert data[0]["type"] == "decision"
    assert data[0]["decision_status"] == "accepted"


def test_list_decisions_filter_project(client, db, sample_project):
    # Create a second project
    from tests.factories import make_project

    p2 = make_project(db, name="Other Project")
    db.add(p2)
    db.flush()

    _make_decision(db, sample_project.id, "Decision A")
    _make_decision(db, p2.id, "Decision B")

    r = client.get("/api/decisions", params={"project_id": sample_project.id})
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["name"] == "Decision A"


def test_list_decisions_filter_status(client, db, sample_project):
    _make_decision(db, sample_project.id, "Accepted decision", decision_status="accepted")
    _make_decision(db, sample_project.id, "Proposed decision", decision_status="proposed")

    r = client.get("/api/decisions", params={"status": "accepted"})
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["name"] == "Accepted decision"


def test_an_unknown_status_is_refused_not_silently_empty(client):
    """A typo in a filter that answers ``[]`` is the silent-empty-set trap (ADR-0056)."""
    r = client.get("/api/decisions", params={"status": "aproved"})
    assert r.status_code == 400
    assert "aproved" in r.json()["detail"]


def test_get_decision(client, db, sample_project):
    decision = _make_decision(
        db,
        sample_project.id,
        "Use Redis",
        decision_status="accepted",
        description="Chosen for caching layer.",
    )

    r = client.get(f"/api/decisions/{decision.id}")
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == decision.id
    assert data["name"] == "Use Redis"
    assert data["decision_status"] == "accepted"


def test_get_decision_not_found(client):
    r = client.get("/api/decisions/nonexistent-id")
    assert r.status_code == 404


def test_export_decision(client, db, sample_project):
    decision = _make_decision(
        db,
        sample_project.id,
        "Use PostgreSQL",
        decision_status="accepted",
        description="We chose PostgreSQL for reliability.",
    )

    r = client.get(f"/api/decisions/{decision.id}/export")
    assert r.status_code == 200
    assert "text/markdown" in r.headers["content-type"]

    body = r.text
    assert "# Use PostgreSQL" in body
    assert "## Status" in body
    assert "Accepted" in body
    assert "We chose PostgreSQL for reliability." in body


class TestTheDocumentedWayToWriteADecision:
    """The address the read surface points at (ADR-0115, ADR-0118).

    ``decision_admin`` is read-only on purpose, and for two revisions it said so while
    naming a write that did not exist: ``POST /nodes`` with ``type="decision"``, when a
    decision was a *label* (ADR-0004). ADR-0115 fixed the sentence. ADR-0118 made the
    sentence true instead, because the type it named is the one the data wanted.
    """

    def test_the_type_the_instruction_names_is_a_node_type(self, client, sample_project):
        r = client.post(
            "/api/nodes",
            json={
                "type": "decision",
                "title": "Adopt the graph model",
                "container_id": sample_project.id,
                "status": "accepted",
                "data": {"description": "## Context\n"},
            },
        )
        assert r.status_code == 201, r.text

        listed = client.get("/api/decisions").json()
        assert [d["name"] for d in listed] == ["Adopt the graph model"]
        assert listed[0]["decision_status"] == "accepted"

    def test_a_label_wearing_the_old_data_key_is_refused(self, client, sample_project):
        """The old shape is refused at the door, and the refusal names the one that works.

        ADR-0118 asserted here that the old shape "does not quietly keep working" because
        it produced a label rather than a decision. It produced a label *and a 201*, which
        is quiet — production wrote 17 records that way (ADR-0130).
        """
        r = client.post(
            "/api/nodes",
            json={
                "type": "label",
                "title": "Adopt the graph model",
                "container_id": sample_project.id,
                "data": {"type": "decision", "decision_status": "accepted"},
            },
        )
        assert r.status_code == 422, r.text
        assert "type='decision'" in r.json()["detail"]
        assert client.get("/api/decisions").json() == []
        assert client.get(f"/api/projects/{sample_project.id}/labels").json() == []

    def test_the_same_write_reaches_the_v1_read_surface(self, client, db, sample_project):
        raw = _read_key(db)
        client.post(
            "/api/nodes",
            json={
                "type": "decision",
                "title": "Adopt the graph model",
                "container_id": sample_project.id,
                "status": "accepted",
            },
        )
        r = client.get("/api/v1/decisions", headers={"X-API-Key": raw})
        assert r.status_code == 200
        assert [d["name"] for d in r.json()] == ["Adopt the graph model"]


class TestASupersededDecisionNamesItsSuccessor:
    """ADR-0118's whole point.

    Production held nine records whose status said "superseded" and whose only edge was
    the ``contains`` from their project — the word said a replacement existed and nothing
    in the database said what it was.
    """

    def test_supersession_writes_the_edge_and_the_status_together(self, client, db, sample_project):
        old = _make_decision(db, sample_project.id, "Use MySQL", decision_status="accepted")
        new = _make_decision(db, sample_project.id, "Use PostgreSQL", decision_status="accepted")

        r = client.post(f"/api/decisions/{new.id}/supersedes/{old.id}")
        assert r.status_code == 200, r.text
        assert [n["id"] for n in r.json()["supersedes"]] == [old.id]

        replaced = client.get(f"/api/decisions/{old.id}").json()
        assert replaced["decision_status"] == "superseded"
        assert [n["id"] for n in replaced["superseded_by"]] == [new.id]

    def test_withdrawing_it_brings_the_older_record_back(self, client, db, sample_project):
        old = _make_decision(db, sample_project.id, "Use MySQL", decision_status="accepted")
        new = _make_decision(db, sample_project.id, "Use PostgreSQL", decision_status="accepted")
        client.post(f"/api/decisions/{new.id}/supersedes/{old.id}")

        r = client.delete(f"/api/decisions/{new.id}/supersedes/{old.id}")
        assert r.status_code == 200, r.text
        replaced = client.get(f"/api/decisions/{old.id}").json()
        assert replaced["decision_status"] == "accepted"
        assert replaced["superseded_by"] == []

    def test_withdrawing_a_supersession_that_does_not_exist_is_404(self, client, db, sample_project):
        a = _make_decision(db, sample_project.id, "A")
        b = _make_decision(db, sample_project.id, "B")
        assert client.delete(f"/api/decisions/{a.id}/supersedes/{b.id}").status_code == 404

    def test_a_decision_cannot_supersede_itself(self, client, db, sample_project):
        d = _make_decision(db, sample_project.id, "Use PostgreSQL")
        r = client.post(f"/api/decisions/{d.id}/supersedes/{d.id}")
        assert r.status_code == 400

    def test_the_export_says_what_replaced_it(self, client, db, sample_project):
        old = _make_decision(db, sample_project.id, "Use MySQL", decision_status="accepted")
        new = _make_decision(db, sample_project.id, "Use PostgreSQL", decision_status="accepted")
        client.post(f"/api/decisions/{new.id}/supersedes/{old.id}")

        body = client.get(f"/api/decisions/{old.id}/export").text
        assert "Superseded by Use PostgreSQL" in body
        assert "## Supersedes" in client.get(f"/api/decisions/{new.id}/export").text

    def test_only_a_decision_may_sit_at_either_end(self, client, db, sample_project):
        """ADR-0078's declarations, which the label shape could not express."""
        d = _make_decision(db, sample_project.id, "Use PostgreSQL")
        r = client.post(
            f"/api/nodes/{d.id}/edges",
            json={"target_id": sample_project.id, "rel_type": "supersedes"},
        )
        assert r.status_code == 400
        assert "supersedes" in r.json()["detail"]


class TestADecisionNamesTheWorkItGoverns:
    def test_governing_reads_from_the_works_side(self, client, db, sample_project):
        from tests.factories import make_task

        task = make_task(db, project_id=sample_project.id, title="Migrate the schema")
        db.add(task)
        db.commit()
        d = _make_decision(db, sample_project.id, "Use PostgreSQL", decision_status="accepted")

        r = client.post(
            f"/api/nodes/{d.id}/edges",
            json={"target_id": task.id, "rel_type": "governs"},
        )
        assert r.status_code in (200, 201), r.text

        governing = client.get(f"/api/nodes/{task.id}/decisions").json()
        assert [x["id"] for x in governing] == [d.id]
        assert [n["id"] for n in client.get(f"/api/decisions/{d.id}").json()["governs"]] == [task.id]

    def test_a_decision_cannot_govern_a_label(self, client, db, sample_project):
        d = _make_decision(db, sample_project.id, "Use PostgreSQL")
        label = graph.create_label(db, sample_project.id, name="infra")
        db.commit()
        r = client.post(
            f"/api/nodes/{d.id}/edges",
            json={"target_id": label.id, "rel_type": "governs"},
        )
        assert r.status_code == 400


class TestADecisionNamesItsPremisesAndItsConflicts:
    """ADR-0127. Production ran with 103 records, two ``supersedes`` edges and one
    ``governs``: 98 decisions named nothing and were named by nothing, because the two
    relations a record most often actually has did not exist."""

    def _link(self, client, source, target, rel):
        return client.post(f"/api/nodes/{source.id}/edges", json={"target_id": target.id, "rel_type": rel})

    def test_a_premise_reads_from_both_ends(self, client, db, sample_project):
        newer = _make_decision(db, sample_project.id, "Stream the backfill", decision_status="accepted")
        premise = _make_decision(db, sample_project.id, "Use PostgreSQL", decision_status="accepted")

        assert self._link(client, newer, premise, "requires").status_code in (200, 201)

        assert [n["id"] for n in client.get(f"/api/decisions/{newer.id}").json()["requires"]] == [premise.id]
        assert [n["id"] for n in client.get(f"/api/decisions/{premise.id}").json()["required_by"]] == [newer.id]

    def test_a_premise_does_not_retire_the_far_end(self, client, db, sample_project):
        """The difference from ``supersedes``: that one marks the target replaced."""
        newer = _make_decision(db, sample_project.id, "Stream the backfill", decision_status="accepted")
        premise = _make_decision(db, sample_project.id, "Use PostgreSQL", decision_status="accepted")

        self._link(client, newer, premise, "requires")

        assert client.get(f"/api/decisions/{premise.id}").json()["decision_status"] == "accepted"

    def test_a_conflict_is_read_from_both_ends_though_stored_from_one(self, client, db, sample_project):
        """The claim is symmetric. A record reading only its own outgoing edges would
        answer "no conflicts" while the record it contradicts already said otherwise, and
        nothing on either page would say which end was telling the truth."""
        a = _make_decision(db, sample_project.id, "Redis for the retry queue", decision_status="accepted")
        b = _make_decision(db, sample_project.id, "SQS for the retry queue", decision_status="accepted")

        assert self._link(client, a, b, "conflicts_with").status_code in (200, 201)

        assert [n["id"] for n in client.get(f"/api/decisions/{a.id}").json()["conflicts_with"]] == [b.id]
        assert [n["id"] for n in client.get(f"/api/decisions/{b.id}").json()["conflicts_with"]] == [a.id]

    def test_a_conflict_written_from_both_sides_is_named_once(self, client, db, sample_project):
        """Nothing stops a client writing the edge in both directions; the read must not
        then show the same conflict twice."""
        a = _make_decision(db, sample_project.id, "Redis for the retry queue", decision_status="accepted")
        b = _make_decision(db, sample_project.id, "SQS for the retry queue", decision_status="accepted")

        self._link(client, a, b, "conflicts_with")
        self._link(client, b, a, "conflicts_with")

        assert [n["id"] for n in client.get(f"/api/decisions/{a.id}").json()["conflicts_with"]] == [b.id]
        assert [n["id"] for n in client.get(f"/api/decisions/{b.id}").json()["conflicts_with"]] == [a.id]

    def test_only_a_decision_may_sit_at_either_end(self, client, db, sample_project):
        from tests.factories import make_task

        task = make_task(db, project_id=sample_project.id, title="Migrate the schema")
        db.add(task)
        db.commit()
        d = _make_decision(db, sample_project.id, "Use PostgreSQL")

        for rel in ("requires", "conflicts_with"):
            r = client.post(f"/api/nodes/{d.id}/edges", json={"target_id": task.id, "rel_type": rel})
            assert r.status_code == 400, rel
            # The refusal has to name a relation that *would* work — an agent reads the
            # error, not always the docs (ADR-0078).
            assert "governs" in r.json()["detail"], rel

    def test_the_vocabulary_reaches_agents(self, client, db):
        """Declared but absent from ``/api/v1/edge-types`` is a relation nothing can learn."""
        key = _read_key(db, "tdp_test_rel_vocab")
        rows = client.get("/api/v1/edge-types", headers={"X-API-Key": key}).json()
        relations = {r["key"]: r for r in rows["relations"]}
        for rel in ("requires", "conflicts_with"):
            assert rel in relations, rel
            assert relations[rel]["allowed_source"] == {"types": ["decision"]}
            assert relations[rel]["allowed_target"] == {"types": ["decision"]}

    def test_a_symmetric_relation_is_stored_once_and_dropped_from_either_end(self, client, db, sample_project):
        """``edge_types.is_symmetric`` decided nothing before ADR-0127. It does now, and
        this is the behaviour it decides: the reverse edge already *is* this edge."""
        from app.models import Edge

        a = _make_decision(db, sample_project.id, "Redis for the retry queue", decision_status="accepted")
        b = _make_decision(db, sample_project.id, "SQS for the retry queue", decision_status="accepted")

        self._link(client, a, b, "conflicts_with")
        self._link(client, b, a, "conflicts_with")
        rows = db.query(Edge).filter(Edge.rel_type == "conflicts_with").all()
        assert len(rows) == 1

        # Named from the end that does not hold the row, and it still comes off.
        r = client.delete(f"/api/nodes/{b.id}/edges", params={"target_id": a.id, "rel_type": "conflicts_with"})
        assert r.status_code in (200, 204), r.text
        assert db.query(Edge).filter(Edge.rel_type == "conflicts_with").count() == 0

    def test_an_asymmetric_relation_still_keeps_its_direction(self, client, db, sample_project):
        """The negative control: ``requires`` is not symmetric, so both directions are
        two different claims and both rows exist."""
        from app.models import Edge

        a = _make_decision(db, sample_project.id, "Stream the backfill", decision_status="accepted")
        b = _make_decision(db, sample_project.id, "Use PostgreSQL", decision_status="accepted")

        self._link(client, a, b, "requires")
        self._link(client, b, a, "requires")
        assert db.query(Edge).filter(Edge.rel_type == "requires").count() == 2
