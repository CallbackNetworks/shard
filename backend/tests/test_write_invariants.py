"""The wiring that has no failure symptom of its own (ADR-0161).

An invariant registers itself when its module is imported, and the write paths ask
``check_write``. Both halves are silent when broken: a rule whose module never gets
imported is simply not there, and a write path that stops calling ``check_write``
returns 200 exactly as it did before the rule existed. Neither shows up as an error —
the only symptom is data nobody notices until it is counted, which is how ADR-0159's
seventeen dead ends were found.

So this file asserts the wiring itself, not any one rule's logic (those live with the
type they constrain, in ``test_decisions_router.py``).
"""

import pytest

from app.services import graph, write_invariants  # noqa: F401  (graph imports the rule modules)
from app.services.errors import ServiceError


class TestTheRulesAreActuallyRegistered:
    def test_importing_the_service_layer_registers_the_decision_rules(self):
        """ADR-0159's three rules, reachable because ``graph`` pulls in their module.

        A count rather than a list of names: the point is that importing the service
        layer is enough, and a fourth rule arriving should not have to edit a test that
        is about the mechanism.
        """
        registered = write_invariants.registered_types()
        assert registered.get(graph.NODE_DECISION, 0) >= 2
        assert registered.get(write_invariants.ANY, 0) >= 1

    def test_an_any_rule_sees_a_write_claiming_another_type(self, client, sample_project):
        """Why ``ANY`` exists: the write says ``label`` and means ``decision``, so a rule
        keyed on the type in the payload would be registered under the one type it can
        never see (ADR-0130)."""
        r = client.post(
            "/api/nodes",
            json={
                "type": "label",
                "title": "Adopt the graph model",
                "container_id": sample_project.id,
                "data": {"type": "decision"},
            },
        )
        assert r.status_code == 422, r.text

    def test_a_type_with_no_rules_is_written_without_one(self, client, sample_project):
        """The negative control. Most types have no invariants and must not acquire one
        by being routed through the same call."""
        r = client.post(
            "/api/nodes",
            json={"type": "task", "title": "Ordinary work", "container_id": sample_project.id},
        )
        assert r.status_code == 201, r.text


class TestTheCheckItself:
    def test_a_write_with_no_fields_carries_nothing_to_be_wrong_about(self, db):
        write_invariants.check_write(db, graph.NODE_DECISION, None)
        write_invariants.check_write(db, graph.NODE_DECISION, {})

    def test_a_refusal_is_a_service_error_so_both_doors_render_it_the_same(self, db, sample_project):
        """ADR-0085: a rule raising ``HTTPException`` would move the refusal back into the
        routers, where it would be written twice and could drift."""
        decision = graph.create_decision(db, sample_project.id, name="Use MySQL", decision_status="accepted")
        db.commit()
        with pytest.raises(ServiceError):
            write_invariants.check_write(db, graph.NODE_DECISION, {"status": "superseded"}, node_id=decision.id)

    def test_registering_a_rule_makes_it_run(self, db):
        """The mechanism end to end, on a type nothing else registers against."""
        seen = []

        @write_invariants.register("test_only_type")
        def _rule(db_, node_type, fields, node_id):
            seen.append((node_type, dict(fields), node_id))

        try:
            write_invariants.check_write(db, "test_only_type", {"title": "x"}, node_id="n1")
            write_invariants.check_write(db, graph.NODE_TASK, {"title": "y"})
            assert seen == [("test_only_type", {"title": "x"}, "n1")]
        finally:
            write_invariants._RULES.pop("test_only_type", None)
