"""A picker is built from the rule the write path enforces (ADR-0150).

The defect these tests exist against was not that the endpoint declarations were wrong
— they were right, served on both API doors and drawn on the type registry page. It was
that the one screen where a person picks a relation re-derived the answer itself and got
three things wrong at once: which relations apply, which way the edge points, and what
may sit at the far end. So the assertions here are about *agreement*, not about any
particular relation: every option offered must be an edge ``add_edge`` accepts, and
every edge ``add_edge`` accepts must be offered.
"""

import hashlib

from app.models import ApiKey, EdgeType, NodeType
from app.services import graph
from app.services import graph_registry as registry


def _options(db, node_type):
    return registry.relation_options(db, node_type)


def _keys(options, direction=None):
    return {o["rel_type"] for o in options if direction is None or o["direction"] == direction}


class TestEveryOptionIsAnEdgeTheWritePathTakes:
    def test_no_option_is_refused_by_add_edge(self, db):
        """The whole point: an offered option must not be a guaranteed 400."""
        for nt in db.query(NodeType).all():
            for opt in _options(db, nt.key):
                for other in opt["other_types"]:
                    source, target = (nt.key, other) if opt["direction"] == "outgoing" else (other, nt.key)
                    assert graph.relation_accepts(db, opt["rel_type"], source, target), (
                        f"offered {nt.key} {opt['direction']} {opt['rel_type']} with "
                        f"{other} at the far end, which the write path refuses"
                    )

    def test_nothing_the_write_path_accepts_is_missing(self, db):
        """The reverse direction: a legal edge absent from the list is a capability the
        UI cannot reach, which is how 'owns' and 'governs' became unreachable from a
        project — both have the project at the *target* end, and the old picker could
        only ever write outgoing."""
        type_keys = [k for (k,) in db.query(NodeType.key).all()]
        rel_keys = [k for (k,) in db.query(EdgeType.key).all()]
        for subject in type_keys:
            offered = {
                (o["rel_type"], o["direction"], other) for o in _options(db, subject) for other in o["other_types"]
            }
            for rel in rel_keys:
                symmetric = bool(db.get(EdgeType, rel).is_symmetric)
                for other in type_keys:
                    if graph.relation_accepts(db, rel, subject, other):
                        assert (rel, "outgoing", other) in offered
                    if graph.relation_accepts(db, rel, other, subject) and not symmetric:
                        assert (rel, "incoming", other) in offered


class TestTheListIsNarrowerThanTheWholeVocabulary:
    """A picker offering everything is the thing being replaced — these numbers are the
    defect, restated as a test. Nine relations were offered on every node."""

    def test_a_project_cannot_source_most_relations(self, db):
        opts = _options(db, graph.NODE_PROJECT)
        assert _keys(opts, "outgoing") == {"contains", "labeled"}
        # Both of these were unreachable before: the project sits at the target end.
        assert "owns" in _keys(opts, "incoming")
        assert "governs" in _keys(opts, "incoming")

    def test_a_task_is_never_the_source_of_a_decision_relation(self, db):
        outgoing = _keys(_options(db, graph.NODE_TASK), "outgoing")
        for rel in ("supersedes", "requires", "governs", "conflicts_with"):
            assert rel not in outgoing

    def test_a_label_reaches_almost_nothing(self, db):
        """`labeled` declares only a *target* rule, so a label may legally point at
        another label — the narrowing is honest about the declaration, it does not
        tighten it. What a label can never be is the source of the six relations that
        declare one, which is what the old picker offered it."""
        outgoing = _keys(_options(db, graph.NODE_LABEL), "outgoing")
        assert outgoing == {"contains", "labeled"}
        assert "labeled" in _keys(_options(db, graph.NODE_LABEL), "incoming")


class TestDirection:
    def test_a_symmetric_relation_is_offered_once(self, db):
        """The reverse row *is* this edge (ADR-0127), so a second option would be two
        controls writing the same row."""
        opts = [o for o in _options(db, graph.NODE_DECISION) if o["rel_type"] == "conflicts_with"]
        assert len(opts) == 1
        assert opts[0]["direction"] == "outgoing"
        assert opts[0]["is_symmetric"] is True

    def test_a_directed_relation_is_offered_from_both_ends(self, db):
        opts = [o for o in _options(db, graph.NODE_DECISION) if o["rel_type"] == "supersedes"]
        assert {o["direction"] for o in opts} == {"outgoing", "incoming"}

    def test_containment_sorts_first(self, db):
        opts = _options(db, graph.NODE_TASK)
        assert opts[0]["is_containment"] is True


class TestTheFarEndIsResolvedToConcreteTypes:
    def test_a_role_rule_is_expanded_not_echoed(self, db):
        """`depends_on` declares roles, not types. A client filtering candidates by role
        would need its own copy of the role table — the second vocabulary ADR-0056 is
        about — so the far end arrives as type keys."""
        db.add(NodeType(key="chore", label="Chore", roles=[graph.ROLE_TASK]))
        db.commit()
        opt = next(
            o for o in _options(db, graph.NODE_TASK) if o["rel_type"] == "depends_on" and o["direction"] == "outgoing"
        )
        assert "chore" in opt["other_types"]
        assert graph.NODE_PROJECT not in opt["other_types"]

    def test_a_custom_relation_with_no_declaration_reaches_every_type(self, db):
        """An unconstrained relation stays unconstrained — the picker narrows by the
        declaration, it does not invent one."""
        db.add(EdgeType(key="relates_to", label="Relates to"))
        db.commit()
        opt = next(
            o for o in _options(db, graph.NODE_LABEL) if o["rel_type"] == "relates_to" and o["direction"] == "outgoing"
        )
        assert set(opt["other_types"]) == {k for (k,) in db.query(NodeType.key).all()}


class TestBothDoorsAnswerTheSame:
    def test_internal_and_v1_agree(self, client, db):
        raw = "probe-key"
        db.add(
            ApiKey(
                name="probe",
                key_hash=hashlib.sha256(raw.encode()).hexdigest(),
                scopes=["read"],
            )
        )
        db.commit()
        internal = client.get("/api/graph-types/edges/options/project")
        external = client.get("/api/v1/edge-types/options/project", headers={"X-API-Key": raw})
        assert internal.status_code == 200
        assert external.status_code == 200
        assert internal.json() == external.json()

    def test_an_undeclared_type_gets_the_free_form_answer(self, client):
        """Not an error, and not empty. A type that declares no roles is generic
        scaffolding that may nest freely (ADR-0078's free-form graph), so the honest
        answer for a type the registry has never heard of is: containment, and whatever
        else declares no source rule. Answering 404 or [] here would make the picker
        claim a node cannot be linked when the write path would accept the edge."""
        r = client.get("/api/graph-types/edges/options/nonexistent-type")
        assert r.status_code == 200
        assert _keys(r.json(), "outgoing") == {"contains", "labeled"}
