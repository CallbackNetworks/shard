import pytest

from app.services import graph
from tests.factories import make_task


def _make_task(db, project_id, **overrides):
    defaults = {"project_id": project_id, "title": "Test task", "status": "todo", "priority": "medium"}
    defaults.update(overrides)
    t = make_task(db, **defaults)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


# --- 1. List rules (empty) ---


def test_list_rules_empty(client):
    r = client.get("/api/workflow-rules")
    assert r.status_code == 200
    assert r.json() == []


# --- 2. Create a rule ---


def test_create_rule(client):
    r = client.post(
        "/api/workflow-rules",
        json={
            "name": "Auto-prioritize",
            "trigger": "node.created",
            "conditions": [{"field": "status", "op": "eq", "value": "todo"}],
            "actions": [{"type": "set_priority", "value": "high"}],
            "active": True,
        },
    )
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Auto-prioritize"
    assert data["trigger"] == "node.created"
    assert data["active"] is True
    assert data["project_id"] is None
    assert len(data["conditions"]) == 1
    assert len(data["actions"]) == 1
    assert data["run_count"] == 0
    assert "id" in data
    assert "created_at" in data


# --- 3. Create a rule with project scope ---


def test_create_rule_with_project_scope(client, sample_project):
    r = client.post(
        "/api/workflow-rules",
        json={
            "name": "Project-scoped rule",
            "project_id": sample_project.id,
            "trigger": "node.updated",
            "conditions": [],
            # Was "urgent" before ADR-0047 — no such priority exists, so the rule was
            # accepted and then did nothing; the value enum now rejects it at write time.
            "actions": [{"type": "set_priority", "value": "high"}],
        },
    )
    assert r.status_code == 201
    data = r.json()
    assert data["project_id"] == sample_project.id
    assert data["name"] == "Project-scoped rule"


# --- 4. Get a single rule ---


def test_get_rule(client):
    create_r = client.post(
        "/api/workflow-rules",
        json={
            "name": "Fetch me",
            "trigger": "node.created",
            "conditions": [],
            "actions": [{"type": "set_status", "value": "in_progress"}],
        },
    )
    rule_id = create_r.json()["id"]

    r = client.get(f"/api/workflow-rules/{rule_id}")
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == rule_id
    assert data["name"] == "Fetch me"


# --- 5. Update a rule (change name and actions) ---


def test_update_rule(client):
    create_r = client.post(
        "/api/workflow-rules",
        json={
            "name": "Original name",
            "trigger": "node.created",
            "conditions": [],
            "actions": [{"type": "set_priority", "value": "low"}],
        },
    )
    rule_id = create_r.json()["id"]

    r = client.patch(
        f"/api/workflow-rules/{rule_id}",
        json={
            "name": "Updated name",
            "actions": [{"type": "set_priority", "value": "high"}],
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Updated name"
    assert data["actions"][0]["value"] == "high"


# --- 6. Deactivate a rule ---


def test_update_rule_deactivate(client):
    create_r = client.post(
        "/api/workflow-rules",
        json={
            "name": "Active rule",
            "trigger": "node.created",
            "conditions": [],
            "actions": [{"type": "set_status", "value": "done"}],
            "active": True,
        },
    )
    rule_id = create_r.json()["id"]

    r = client.patch(f"/api/workflow-rules/{rule_id}", json={"active": False})
    assert r.status_code == 200
    assert r.json()["active"] is False


# --- 7. Delete a rule ---


def test_delete_rule(client):
    create_r = client.post(
        "/api/workflow-rules",
        json={
            "name": "To Delete",
            "trigger": "node.created",
            "conditions": [],
            "actions": [{"type": "set_priority", "value": "medium"}],
        },
    )
    rule_id = create_r.json()["id"]

    r = client.delete(f"/api/workflow-rules/{rule_id}")
    assert r.status_code == 204

    listing = client.get("/api/workflow-rules")
    assert len(listing.json()) == 0


# --- 8. Get nonexistent rule returns 404 ---


def test_get_nonexistent_rule(client):
    r = client.get("/api/workflow-rules/nonexistent-id")
    assert r.status_code == 404


# --- 9. List rules filtered by project_id ---


def test_list_rules_filter_project(client, sample_project):
    # Create a global rule (no project_id)
    client.post(
        "/api/workflow-rules",
        json={
            "name": "Global rule",
            "trigger": "node.created",
            "conditions": [],
            "actions": [{"type": "set_priority", "value": "low"}],
        },
    )
    # Create a project-scoped rule
    client.post(
        "/api/workflow-rules",
        json={
            "name": "Project rule",
            "project_id": sample_project.id,
            "trigger": "node.created",
            "conditions": [],
            "actions": [{"type": "set_priority", "value": "high"}],
        },
    )

    # Filter by project_id should return both the project-scoped rule and global rules
    r = client.get(f"/api/workflow-rules?project_id={sample_project.id}")
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 2
    names = {i["name"] for i in items}
    assert "Global rule" in names
    assert "Project rule" in names


# --- 10. Dry-run test a rule against a matching task ---


def test_dry_run_rule(client, db, sample_project):
    task = _make_task(db, sample_project.id, status="todo", priority="medium")

    create_r = client.post(
        "/api/workflow-rules",
        json={
            "name": "Match todo tasks",
            "trigger": "node.created",
            "conditions": [{"field": "status", "op": "eq", "value": "todo"}],
            "actions": [{"type": "set_priority", "value": "high"}],
        },
    )
    rule_id = create_r.json()["id"]

    r = client.post(f"/api/workflow-rules/{rule_id}/test?task_id={task.id}")
    assert r.status_code == 200
    data = r.json()
    assert data["would_fire"] is True
    assert data["conditions_met"] == [True]
    assert len(data["actions"]) == 1
    assert data["actions"][0]["type"] == "set_priority"
    assert data["actions"][0]["value"] == "high"


# --- Vocabulary validation (a typo used to save a rule that silently never fired) ---


def _rule_body(**overrides):
    body = {
        "name": "R",
        "trigger": "node.created",
        "conditions": [{"field": "status", "op": "eq", "value": "todo"}],
        "actions": [{"type": "set_priority", "value": "high"}],
    }
    body.update(overrides)
    return body


@pytest.mark.parametrize(
    "body",
    [
        _rule_body(conditions=[{"field": "title", "op": "contains", "value": "x"}]),
        _rule_body(conditions=[{"field": "status", "op": "equals", "value": "todo"}]),
        _rule_body(actions=[{"type": "set_field", "value": "high"}]),
        _rule_body(trigger="task.exploded"),
    ],
    ids=["unknown-field", "unknown-op", "unknown-action", "unknown-trigger"],
)
def test_create_rejects_unknown_vocabulary(client, body):
    assert client.post("/api/workflow-rules", json=body).status_code == 422


def test_patch_rejects_unknown_vocabulary(client):
    rule_id = client.post("/api/workflow-rules", json=_rule_body()).json()["id"]

    r = client.patch(
        f"/api/workflow-rules/{rule_id}",
        json={"conditions": [{"field": "label", "op": "eq", "value": "x"}]},
    )
    assert r.status_code == 422


def test_error_names_the_allowed_values(client):
    r = client.post("/api/workflow-rules", json=_rule_body(actions=[{"type": "set_field", "value": "high"}]))
    assert "set_priority" in r.text


def test_dry_run_sees_labels(client, db, sample_project):
    # has_label needs a session the engine cannot get from a TaskView, so the dry-run
    # used to report every label condition as unmet (ADR-0045).
    task = _make_task(db, sample_project.id)
    label = graph.create_label(db, sample_project.id, name="urgent", color="#f00")
    graph.set_label(db, task.id, label.id)
    db.commit()

    rule_id = client.post(
        "/api/workflow-rules",
        json=_rule_body(conditions=[{"field": "has_label", "op": "eq", "value": "urgent"}]),
    ).json()["id"]

    data = client.post(f"/api/workflow-rules/{rule_id}/test?task_id={task.id}").json()
    assert data["conditions_met"] == [True]
    assert data["would_fire"] is True


# --- The dry-run predicts outcomes instead of echoing the rule back (ADR-0054) ---


def test_dry_run_does_not_promise_what_the_engine_would_skip(client, db, sample_project):
    """The bug this closes: ``actions`` was ``rule.actions`` returned verbatim, so a rule
    whose label does not exist got a green light from the very button meant to catch it."""
    task = _make_task(db, sample_project.id)
    rule_id = client.post(
        "/api/workflow-rules",
        json=_rule_body(conditions=[], actions=[{"type": "add_label", "value": "security"}]),
    ).json()["id"]

    data = client.post(f"/api/workflow-rules/{rule_id}/test?node_id={task.id}").json()

    assert data["would_fire"] is True  # the conditions do match
    assert data["actions"][0]["outcome"] == "skipped"  # and the action still cannot run
    assert data["actions"][0]["reason"] == "label_not_found"
    assert data["effect_count"] == 0


def test_dry_run_separates_would_change_from_would_run(client, db, sample_project):
    task = _make_task(db, sample_project.id, priority="high")
    rule_id = client.post(
        "/api/workflow-rules",
        json=_rule_body(conditions=[], actions=[{"type": "set_priority", "value": "high"}]),
    ).json()["id"]

    data = client.post(f"/api/workflow-rules/{rule_id}/test?node_id={task.id}").json()

    assert data["would_fire"] is True
    assert data["actions"][0]["outcome"] == "no_op"
    assert data["effect_count"] == 0


def test_dry_run_accepts_a_node_that_is_not_a_task(client, db, sample_project):
    """Rules trigger on node.created for every type (ADR-0049); the dry-run only knew
    about tasks, so the one case where every action is skipped could not be checked."""
    rule_id = client.post(
        "/api/workflow-rules",
        json=_rule_body(conditions=[], actions=[{"type": "set_priority", "value": "high"}]),
    ).json()["id"]

    data = client.post(f"/api/workflow-rules/{rule_id}/test?node_id={sample_project.id}").json()

    assert data["node"]["type"] == "project"
    assert data["actions"][0]["outcome"] == "skipped"
    assert data["actions"][0]["reason"] == "not_a_task"


def test_dry_run_still_accepts_the_old_task_id_parameter(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    rule_id = client.post("/api/workflow-rules", json=_rule_body(conditions=[])).json()["id"]

    assert client.post(f"/api/workflow-rules/{rule_id}/test?task_id={task.id}").status_code == 200


def test_dry_run_needs_a_subject(client):
    rule_id = client.post("/api/workflow-rules", json=_rule_body()).json()["id"]
    assert client.post(f"/api/workflow-rules/{rule_id}/test").status_code == 422


# --- Saving a rule says what can never work (ADR-0054) ---


def test_saving_a_rule_warns_about_a_label_that_does_not_exist(client):
    r = client.post("/api/workflow-rules", json=_rule_body(actions=[{"type": "add_label", "value": "security"}]))

    assert r.status_code == 201  # a warning, not a rejection: the label may appear later
    assert [(w["type"], w["reason"]) for w in r.json()["warnings"]] == [("add_label", "label_not_found")]


def test_the_warning_clears_itself_once_the_label_exists(client, db, sample_project):
    """Warnings are about the world, not the rule, so they are computed per read: a stored
    one would keep accusing a rule the user has already fixed."""
    rule_id = client.post(
        "/api/workflow-rules", json=_rule_body(actions=[{"type": "add_label", "value": "security"}])
    ).json()["id"]
    assert client.get(f"/api/workflow-rules/{rule_id}").json()["warnings"]

    graph.create_label(db, sample_project.id, name="security", color="#f00")
    db.commit()

    assert client.get(f"/api/workflow-rules/{rule_id}").json()["warnings"] == []


def test_a_working_rule_carries_no_warning(client):
    r = client.post("/api/workflow-rules", json=_rule_body())
    assert r.json()["warnings"] == []
    assert client.get("/api/workflow-rules").json()[0]["warnings"] == []


# --- A condition its trigger can never answer is a rejection, not a warning (ADR-0055) ---


def test_a_condition_the_trigger_never_supplies_is_rejected(client):
    """Not a warning: a warning may come true tomorrow, but ``node.created`` will never
    carry a ``changed_field``. Accepting it would add one more healthy-looking rule that
    never fires — the failure this whole line of ADRs exists to remove."""
    r = client.post(
        "/api/workflow-rules",
        json=_rule_body(trigger="node.created", conditions=[{"field": "changed_field", "op": "eq", "value": "status"}]),
    )
    assert r.status_code == 422
    assert "changed_field" in r.text


def test_the_rejection_names_what_the_trigger_does_carry(client):
    r = client.post(
        "/api/workflow-rules",
        json=_rule_body(trigger="node.updated", conditions=[{"field": "edge_type", "op": "eq", "value": "labeled"}]),
    )
    assert r.status_code == 422
    assert "changed_field" in r.text  # what node.updated offers instead


def test_a_context_condition_is_accepted_by_its_own_trigger(client):
    r = client.post(
        "/api/workflow-rules",
        json=_rule_body(trigger="node.updated", conditions=[{"field": "changed_field", "op": "eq", "value": "status"}]),
    )
    assert r.status_code == 201


def test_patch_is_checked_against_the_merged_rule(client):
    """Changing only the trigger can strand conditions that were legal under the old one."""
    rule_id = client.post(
        "/api/workflow-rules",
        json=_rule_body(trigger="edge.added", conditions=[{"field": "edge_type", "op": "eq", "value": "labeled"}]),
    ).json()["id"]

    assert client.patch(f"/api/workflow-rules/{rule_id}", json={"trigger": "node.created"}).status_code == 422


def test_the_vocabulary_says_which_fields_each_trigger_carries(client):
    """So the editor offers only the fields that mean something, instead of letting the
    user build a rule the write surface then rejects."""
    body = client.get("/api/workflow-rules/vocabulary").json()
    assert body["trigger_context_fields"]["node.created"] == []
    assert body["trigger_context_fields"]["node.updated"] == ["changed_field"]
    assert body["trigger_context_fields"]["edge.added"] == ["edge_side", "edge_type", "other_type"]


# --- A subject is not an event, so some conditions have no answer (ADR-0055) ---


def test_dry_run_reports_an_undecidable_condition_as_null(client, db, sample_project):
    """Reporting it ``False`` would make every ``node.updated`` rule say "would not fire" —
    the same false answer as the old dry-run, in the opposite direction."""
    task = _make_task(db, sample_project.id)
    rule_id = client.post(
        "/api/workflow-rules",
        json=_rule_body(trigger="node.updated", conditions=[{"field": "changed_field", "op": "eq", "value": "status"}]),
    ).json()["id"]

    data = client.post(f"/api/workflow-rules/{rule_id}/test?node_id={task.id}").json()
    assert data["conditions_met"] == [None]
    assert data["would_fire"] is None
    # Still predicted: the answer "if it fires, here is what it would do" is the useful part.
    assert [a["outcome"] for a in data["actions"]] == ["applied"]


def test_an_unmet_condition_still_settles_it(client, db, sample_project):
    """False beats null: one condition that definitely does not match ends the question."""
    task = _make_task(db, sample_project.id, status="done")
    rule_id = client.post(
        "/api/workflow-rules",
        json=_rule_body(
            trigger="node.updated",
            conditions=[
                {"field": "status", "op": "eq", "value": "todo"},
                {"field": "changed_field", "op": "eq", "value": "status"},
            ],
        ),
    ).json()["id"]

    data = client.post(f"/api/workflow-rules/{rule_id}/test?node_id={task.id}").json()
    assert data["would_fire"] is False
    assert data["actions"] == []


# --- Every value box knows what belongs in it (ADR-0056) ---


class TestValueVocabulary:
    """The editor rendered one free text box for every action and every condition,
    because the vocabulary that would have told it otherwise was served and never read —
    and for eleven of the eighteen slots it was never served at all. These tests pin the
    served side: a slot with no spec falls back to a free box, which is the defect.
    """

    def test_every_action_type_says_what_its_value_may_be(self, client):
        body = client.get("/api/workflow-rules/vocabulary").json()
        assert sorted(body["action_values"]) == body["action_types"]
        assert all(spec["kind"] in ("enum", "suggest", "free") for spec in body["action_values"].values())

    def test_every_condition_field_says_what_its_value_may_be(self, client):
        body = client.get("/api/workflow-rules/vocabulary").json()
        assert sorted(body["condition_values"]) == body["condition_fields"]
        assert all(spec["kind"] in ("enum", "suggest", "free") for spec in body["condition_values"].values())

    def test_a_closed_set_is_offered_in_the_order_it_means_something(self, client):
        """Alphabetical order would read high/low/medium and put "done" first: the same
        vocabulary, presented as nonsense. The engine's tuple is the order."""
        body = client.get("/api/workflow-rules/vocabulary").json()
        assert body["action_values"]["set_status"] == {
            "kind": "enum",
            "options": ["todo", "in_progress", "done", "failed"],
        }
        assert body["action_values"]["set_priority"]["options"] == ["low", "medium", "high"]

    def test_an_enum_option_is_something_the_write_surface_accepts(self, client):
        """The point of offering a list: everything on it saves. A picker that offers a
        value the schema then rejects is worse than a text box."""
        body = client.get("/api/workflow-rules/vocabulary").json()
        for value in body["action_values"]["set_status"]["options"]:
            r = client.post("/api/workflow-rules", json=_rule_body(actions=[{"type": "set_status", "value": value}]))
            assert r.status_code == 201, value

    def test_labels_that_exist_are_offered_instead_of_typed(self, client, db, sample_project):
        graph.create_label(db, project_id=sample_project.id, name="urgent", color="#f00")
        db.commit()
        body = client.get("/api/workflow-rules/vocabulary").json()
        assert "urgent" in body["action_values"]["add_label"]["options"]
        assert "urgent" in body["condition_values"]["has_label"]["options"]
        # Open, not closed: a rule may name a label that will be created tomorrow, which
        # is why the miss is a warning rather than a 422 (ADR-0054).
        assert body["action_values"]["add_label"]["kind"] == "suggest"

    def test_fire_event_says_how_many_integrations_would_receive_each_event(self, client, db):
        """The one action whose effect lands on another page. Without the count it reads
        as a button that does something, when it may reach nobody."""
        from app.models import Integration

        db.add(Integration(name="ops", type="webhook", url="https://x.test", events=["task.done"], active=True))
        db.commit()
        body = client.get("/api/workflow-rules/vocabulary").json()
        spec = body["action_values"]["fire_event"]
        assert spec["subscribers"]["task.done"] == 1
        assert spec["subscribers"]["task.created"] == 0
        assert set(spec["subscribers"]) == set(spec["options"])

    def test_a_rules_own_event_becomes_offerable_to_the_next_rule(self, client):
        """``fire_event`` takes a free string, so the vocabulary is the built-ins plus
        whatever the user's own active rules emit (ADR-0048)."""
        client.post(
            "/api/workflow-rules",
            json=_rule_body(actions=[{"type": "fire_event", "value": "deploy.requested"}]),
        )
        body = client.get("/api/workflow-rules/vocabulary").json()
        assert "deploy.requested" in body["action_values"]["fire_event"]["options"]

    def test_label_suggestions_can_be_narrowed_to_one_project(self, client, db, sample_project):
        graph.create_label(db, project_id=sample_project.id, name="here", color="#f00")
        other = graph.create_project(db, name="Other")
        graph.create_label(db, project_id=other.id, name="elsewhere", color="#f00")
        db.commit()
        body = client.get(f"/api/workflow-rules/vocabulary?project_id={sample_project.id}").json()
        options = body["action_values"]["add_label"]["options"]
        assert "here" in options and "elsewhere" not in options
