"""A relation declares what may sit at each end (ADR-0078).

The bug these pin is not a crash, it is a success: before this, picking the wrong relation
returned 201 Created, wrote the edge, logged the event — and no read path anywhere
acknowledged it. A wrong relation was indistinguishable from a right one until somebody
noticed the screen had not changed.

The original example here was ``identity contains project``. That one is *legal* since
ADR-0095 — an identity holds the container role, because it is a level people file work
under — so the refusal is now pinned with a type that declares a capability role and no
structural one, which is the shape the rule is actually about.

So the tests come in two halves. One asserts the refusal *teaches*: the error names the
relation the caller should have used. The other asserts the declarations describe the
graph that actually exists — a declaration stricter than reality would reject writes the
product depends on, and it would do it in ``add_edge``, under everything.
"""

import hashlib

import pytest

from app.models import ApiKey, Edge, EdgeType, Node, NodeType
from app.services import ancestry, graph
from app.services.graph_registry import BUILTIN_EDGE_TYPES, relation_vocabulary
from tests.factories import make_project, make_task


def _key(db, name, scopes):
    raw = f"tdp_test_{name}"
    db.add(
        ApiKey(
            name=name,
            key=raw,
            key_hash=hashlib.sha256(raw.encode()).hexdigest(),
            key_last4=raw[-4:],
            scopes=scopes,
            active=True,
        )
    )
    db.commit()
    return raw


@pytest.fixture()
def identity_and_project(db):
    identity = graph.create_identity(db, name="Engineering Lead", color="#818cf8")
    project = make_project(db, name="Payments Reliability")
    db.commit()
    return db.get(Node, identity.id), project


class TestTheRefusalNamesTheRightRelation:
    """An agent always reads the error; it does not always read the docs."""

    @pytest.fixture()
    def persona_type(self, db):
        """A type that declares a capability and no structural role — cannot be a parent."""
        db.add(NodeType(key="persona", label="Persona", roles=[graph.ROLE_SHAREABLE]))
        db.commit()
        return "persona"

    def test_a_type_with_no_structural_role_cannot_contain_and_is_told_so(self, db, persona_type):
        persona = Node(type=persona_type, title="Reviewer")
        db.add(persona)
        project = make_project(db, name="Payments Reliability")
        db.commit()

        with pytest.raises(ValueError) as exc:
            graph.add_edge(db, persona.id, project.id, graph.REL_CONTAINS)

        detail = str(exc.value)
        assert "persona -> project" in detail
        assert "container or a task" in detail

    def test_the_same_pair_through_the_internal_api_is_a_400_not_a_201(self, client, db, persona_type):
        persona = Node(type=persona_type, title="Reviewer")
        db.add(persona)
        project = make_project(db, name="Payments Reliability")
        db.commit()

        resp = client.post(
            f"/api/nodes/{persona.id}/edges",
            json={"target_id": project.id, "rel_type": "contains"},
        )

        assert resp.status_code == 400
        assert "container or a task" in resp.json()["detail"]
        assert db.query(Edge).filter(Edge.rel_type == "contains", Edge.source_id == persona.id).count() == 0

    def test_the_same_pair_through_the_external_api_is_a_400_not_a_201(self, client, db, persona_type):
        persona = Node(type=persona_type, title="Reviewer")
        db.add(persona)
        project = make_project(db, name="Payments Reliability")
        db.commit()
        key = _key(db, "edges_write", ["read", "write"])

        resp = client.post(
            f"/api/v1/nodes/{persona.id}/edges",
            json={"target_id": project.id, "rel_type": "contains"},
            headers={"X-API-Key": key},
        )

        assert resp.status_code == 400
        assert "container or a task" in resp.json()["detail"]

    def test_an_identity_may_now_contain_a_project(self, db, identity_and_project):
        """ADR-0095: the user's own hierarchy is organization -> identity -> project, and
        it was stored as ``contains`` edges the rule used to refuse to recreate."""
        identity, project = identity_and_project

        edge = graph.add_edge(db, identity.id, project.id, graph.REL_CONTAINS)
        db.commit()

        assert edge.rel_type == "contains"
        assert [n.id for n in graph.children_of(db, identity.id)] == [project.id]
        # And the project can say so: the trail is what puts it on screen (ADR-0094).
        trails = ancestry.ancestry_for(db, [project.id])[project.id].trails
        assert [[r.title for r in trail] for trail in trails] == [["Engineering Lead"]]

    def test_owns_is_accepted_for_that_same_pair(self, db, identity_and_project):
        identity, project = identity_and_project

        edge = graph.add_edge(db, identity.id, project.id, graph.REL_OWNS)

        assert edge.rel_type == "owns"
        assert graph.identity_ids_for_project(db, project.id) == [identity.id]

    def test_a_relation_refuses_a_target_it_never_accepts(self, db):
        project = make_project(db, name="Host")
        task = make_task(db, project_id=project.id, title="Work")
        db.commit()

        # in_cycle targets a cycle; a task is not one, and no other relation would
        # take task -> task except depends_on, which the message should offer.
        with pytest.raises(ValueError) as exc:
            graph.add_edge(db, task.id, task.id, graph.REL_IN_CYCLE)
        assert "'depends_on'" in str(exc.value)


class TestOwnsIsTheOnlyNameNow:
    """member_of read backwards; keeping it as an alias would be two names for one thing."""

    def test_the_retired_names_are_gone_from_the_registry(self, db):
        keys = {et.key for et in db.query(EdgeType).all()}
        assert "owns" in keys
        assert "member_of" not in keys
        # assigned_to was declared, never written by any code path, and had zero rows.
        assert "assigned_to" not in keys

    def test_linking_an_identity_writes_an_owns_edge(self, db, identity_and_project):
        identity, project = identity_and_project

        graph.link_membership(db, identity.id, project.id)
        db.commit()

        rel_types = {e.rel_type for e in db.query(Edge).filter(Edge.target_id == project.id).all()}
        assert rel_types == {"owns"}


class TestTheDeclarationsDescribeTheRealGraph:
    """A declaration stricter than reality would reject writes the product depends on."""

    @pytest.mark.parametrize(
        "rel_type,source_type,target_type",
        [
            ("contains", "project", "task"),
            ("contains", "project", "label"),
            ("contains", "project", "cycle"),
            ("contains", "task", "task"),
            ("contains", "goal", "project"),
            ("owns", "identity", "project"),
            ("owns", "identity", "goal"),
            ("depends_on", "task", "task"),
            ("labeled", "task", "label"),
            ("labeled", "goal", "label"),
            ("in_cycle", "task", "cycle"),
        ],
    )
    def test_every_endpoint_pairing_the_product_uses_is_declared_legal(self, db, rel_type, source_type, target_type):
        et = db.get(EdgeType, rel_type)
        assert graph.core._accepts_endpoints(
            db, et, source_type, target_type
        ), f"{source_type} -> {target_type} must stay legal for '{rel_type}'"

    def test_every_edge_in_the_database_satisfies_its_own_declaration(self, db, identity_and_project):
        """The whole graph, not a sampled pair: the check runs under every write."""
        identity, project = identity_and_project
        task = make_task(db, project_id=project.id, title="Work")
        make_task(db, project_id=project.id, parent_id=task.id, title="Subtask")
        cycle = graph.create_cycle(db, project.id, name="Sprint 1")
        label = graph.create_label(db, project.id, name="bug")
        graph.link_membership(db, identity.id, project.id)
        graph.add_edge(db, task.id, cycle.id, graph.REL_IN_CYCLE)
        graph.add_edge(db, task.id, label.id, graph.REL_LABELED)
        db.commit()

        for edge in db.query(Edge).all():
            source, target = db.get(Node, edge.source_id), db.get(Node, edge.target_id)
            et = db.get(EdgeType, edge.rel_type)
            assert graph.core._accepts_endpoints(
                db, et, source.type, target.type
            ), f"existing edge {source.type} -{edge.rel_type}-> {target.type} violates its declaration"

    def test_a_custom_container_type_joins_contains_without_touching_the_seed(self, db):
        """Roles, not a type allow-list, is what keeps user-defined types first class."""
        db.add(NodeType(key="area", label="Area", roles=[graph.ROLE_CONTAINER]))
        db.flush()
        area = graph.create_node(db, "area", title="Platform Group")
        project = make_project(db, name="Q2 Hardening")
        db.commit()

        edge = graph.add_edge(db, area.id, project.id, graph.REL_CONTAINS)

        assert edge.rel_type == "contains"

    def test_a_type_that_declares_a_shape_is_held_to_it(self, db):
        """Declaring roles is opting into a shape; identity's has no place for children."""
        db.add(NodeType(key="person", label="Person", roles=[graph.ROLE_SHAREABLE]))
        db.flush()
        person = graph.create_node(db, "person", title="Someone")
        project = make_project(db, name="Q2 Hardening")
        db.commit()

        with pytest.raises(ValueError):
            graph.add_edge(db, person.id, project.id, graph.REL_CONTAINS)

    def test_a_type_that_declares_nothing_still_nests_freely(self, db):
        """The free-form graph the node explorer exposes is not collateral damage."""
        db.add(NodeType(key="topic", label="Topic"))  # no roles at all
        db.flush()
        parent = graph.create_node(db, "topic", title="Roadmap")
        child = graph.create_node(db, "topic", title="Q3")
        db.commit()

        assert graph.add_edge(db, parent.id, child.id, graph.REL_CONTAINS).rel_type == "contains"


class TestTheVocabularyReachesTheAgent:
    """Serving the declaration is the other half: enforcement alone teaches by refusal."""

    def test_v1_serves_the_relation_vocabulary(self, client, db):
        key = _key(db, "edges_read", ["read"])

        body = client.get("/api/v1/edge-types", headers={"X-API-Key": key}).json()

        by_key = {r["key"]: r for r in body["relations"]}
        assert "owns" in by_key and "member_of" not in by_key
        assert by_key["contains"]["is_containment"] is True
        # contains carries no explicit allow-list: the containment rule is what binds
        # it, so the description has to say so or the served vocabulary is incomplete.
        assert "container" in by_key["contains"]["description"]
        assert by_key["owns"]["allowed_source"]["types"] == ["identity"]
        for relation in body["relations"]:
            assert relation["description"], f"{relation['key']} must say when to use it"

    def test_agent_context_generates_its_relations_from_the_same_registry(self, client, db):
        key = _key(db, "ctx_read", ["read"])

        conventions = client.get("/api/v1/agent-context", headers={"X-API-Key": key}).json()["conventions"]

        assert conventions["relations"] == relation_vocabulary(db)

    def test_every_builtin_relation_declares_a_description(self, db):
        for spec in BUILTIN_EDGE_TYPES:
            assert spec.get("description"), f"{spec['key']} is served to agents; it must describe itself"
