"""Delete semantics under the graph model (ADR-0032, no-primary multi-container).

Deleting a task removes its subtask tree; deleting a project removes the tasks it
exclusively owns but keeps tasks also linked into another project. These replace the
old ``project_id``/``parent_id`` FK ``ondelete CASCADE`` + ORM ``delete-orphan``.
"""

from app.models import Node
from app.services import graph


def _project(client, name):
    return client.post("/api/nodes", json={"type": "project", "title": name}).json()["id"]


def _task(client, project_id, title, parent_id=None):
    body = {"type": "task", "title": title, "container_id": project_id}
    if parent_id:
        body["parent_id"] = parent_id
    return client.post("/api/nodes", json=body).json()["id"]


def test_delete_task_cascades_subtasks(client, db):
    p = _project(client, "P")
    parent = _task(client, p, "parent")
    sub = _task(client, p, "sub", parent_id=parent)
    subsub = _task(client, p, "subsub", parent_id=sub)

    assert client.delete(f"/api/nodes/{parent}").status_code == 204

    # The whole subtree is gone.
    assert db.get(Node, parent) is None
    assert db.get(Node, sub) is None
    assert db.get(Node, subsub) is None


def test_delete_project_deletes_its_tasks(client, db):
    p = _project(client, "P")
    parent = _task(client, p, "parent")
    sub = _task(client, p, "sub", parent_id=parent)

    assert client.delete(f"/api/nodes/{p}").status_code == 204

    assert db.get(Node, parent) is None
    assert db.get(Node, sub) is None


def test_delete_project_keeps_task_shared_with_another(client, db):
    a = _project(client, "A")
    b = _project(client, "B")
    t = _task(client, a, "shared")
    assert client.post(f"/api/projects/{a}/tasks/{t}/memberships/{b}").status_code == 201

    assert client.delete(f"/api/nodes/{a}").status_code == 204

    # The task survives because it is still linked into project B.
    assert db.get(Node, t) is not None
    proj_b = client.get(f"/api/projects/{b}").json()
    assert t in [x["id"] for x in proj_b["tasks"]]


def test_delete_project_keeps_subtask_shared_with_another(client, db):
    a = _project(client, "A")
    b = _project(client, "B")
    parent = _task(client, a, "parent")
    sub = _task(client, a, "sub", parent_id=parent)
    subsub = _task(client, a, "subsub", parent_id=sub)
    assert client.post(f"/api/projects/{a}/tasks/{sub}/memberships/{b}").status_code == 201

    assert client.delete(f"/api/nodes/{a}").status_code == 204

    # The exclusively-owned parent dies; the shared subtask survives with its own subtree.
    assert db.get(Node, parent) is None
    assert db.get(Node, sub) is not None
    assert db.get(Node, subsub) is not None
    proj_b = client.get(f"/api/projects/{b}").json()
    ids = [x["id"] for x in proj_b["tasks"]]
    assert sub in ids
    # Its old parent is gone, so it surfaces as a top-level task in B.
    by_id = {x["id"]: x for x in proj_b["tasks"]}
    assert by_id[sub]["parent_id"] is None


def test_delete_project_deletes_its_labels_and_cycles(client, db):
    # Labels and cycles are node-only (ADR-0033 Phase B) with no ORM cascade;
    # deleting a project must delete the label/cycle nodes it contains.
    p = _project(client, "P")
    label = client.post("/api/nodes", json={"type": "label", "container_id": p, "title": "bug"}).json()["id"]
    cycle = client.post("/api/nodes", json={"type": "cycle", "container_id": p, "title": "Sprint 1"}).json()["id"]

    assert db.get(Node, label) is not None
    assert db.get(Node, cycle) is not None

    # ADR-0043: deleting a container node cascades its tasks + scoped labels/cycles.
    assert client.delete(f"/api/nodes/{p}").status_code == 204
    db.expire_all()

    assert db.get(Node, label) is None
    assert db.get(Node, cycle) is None
    # No dangling edges reference the deleted nodes either.
    assert graph.labels_in_project(db, p) == []
    assert graph.cycles_in_project(db, p) == []


def test_delete_task_keeps_subtask_shared_with_another_project(client, db):
    a = _project(client, "A")
    b = _project(client, "B")
    parent = _task(client, a, "parent")
    sub = _task(client, a, "sub", parent_id=parent)
    assert client.post(f"/api/projects/{a}/tasks/{sub}/memberships/{b}").status_code == 201

    assert client.delete(f"/api/nodes/{parent}").status_code == 204

    # The shared subtask survives in B and fully leaves the deleted tree's project.
    assert db.get(Node, parent) is None
    assert db.get(Node, sub) is not None
    proj_a = client.get(f"/api/projects/{a}").json()
    assert sub not in [x["id"] for x in proj_a["tasks"]]
    proj_b = client.get(f"/api/projects/{b}").json()
    assert sub in [x["id"] for x in proj_b["tasks"]]


class TestNothingIsLeftBehindByADelete:
    """Every row that belongs to a node goes with it (ADR-0131).

    ``delete_node`` used to drop the node and its edges and nothing else, while the task
    delete carried a hand-written list of five peripheral tables. So a container delete
    stranded everything filed under it, and none of it failed loudly: a notification
    survives as a bell entry linking to a page that 404s, a task template survives in the
    global template list, which is unscoped by default.

    Asserted by enumerating the tables rather than by spot-checking one, because the
    defect was never "this table was forgotten" — it was that no list existed.
    """

    @staticmethod
    def _side_rows(db, project_id, task_id):
        from app.models import (
            ActivityWatch,
            Attachment,
            Comment,
            Integration,
            Notification,
            SavedFilter,
            ShareChatLog,
            TaskPullRequest,
            TaskTemplate,
            WebhookDelivery,
            WebhookEvent,
            WorkflowRule,
        )

        return {
            "comment (guest note)": db.query(Comment).filter_by(project_id=project_id).count(),
            "comment (on task)": db.query(Comment).filter_by(task_id=task_id).count(),
            "attachment": db.query(Attachment).filter_by(task_id=task_id).count(),
            "pull request": db.query(TaskPullRequest).filter_by(task_id=task_id).count(),
            "webhook event": db.query(WebhookEvent).filter_by(task_id=task_id).count(),
            "notification (project)": db.query(Notification).filter_by(project_id=project_id).count(),
            "notification (task)": db.query(Notification).filter_by(task_id=task_id).count(),
            "share chat log": db.query(ShareChatLog).filter_by(node_id=project_id).count(),
            "saved filter": db.query(SavedFilter).filter_by(project_id=project_id).count(),
            "task template": db.query(TaskTemplate).filter_by(project_id=project_id).count(),
            "integration": db.query(Integration).filter_by(project_id=project_id).count(),
            "delivery": db.query(WebhookDelivery).count(),
            "workflow rule": db.query(WorkflowRule).filter_by(project_id=project_id).count(),
            "activity watch": db.query(ActivityWatch).filter_by(target_id=project_id).count(),
        }

    @staticmethod
    def _fill(db, project_id, task_id):
        from app.models import (
            ActivityWatch,
            Attachment,
            Comment,
            Integration,
            Notification,
            SavedFilter,
            ShareChatLog,
            TaskPullRequest,
            TaskTemplate,
            WebhookDelivery,
            WebhookEvent,
            WorkflowRule,
        )

        integration = Integration(name="i", type="webhook", url="http://x", project_id=project_id)
        db.add_all(
            [
                Comment(project_id=project_id, task_id=None, body="guest note", guest_name="g"),
                Comment(task_id=task_id, body="on the task"),
                Attachment(
                    task_id=task_id,
                    project_id=project_id,
                    filename="a.txt",
                    storage_path="/tmp/does-not-exist-a.txt",
                ),
                TaskPullRequest(task_id=task_id, repo="o/r", pr_number="1", pr_url="http://pr"),
                WebhookEvent(task_id=task_id, status="success"),
                Notification(type="x", message="m", project_id=project_id),
                Notification(type="x", message="m", task_id=task_id),
                ShareChatLog(node_id=project_id, question="q", answer="a", ip_hash="h"),
                SavedFilter(name="f", project_id=project_id, filters={}),
                TaskTemplate(name="tpl", project_id=project_id),
                integration,
                WorkflowRule(name="r", trigger="node.created", conditions=[], actions=[], project_id=project_id),
                ActivityWatch(kind="node", target_id=project_id, label="P", color="#fff"),
            ]
        )
        db.flush()
        db.add(
            WebhookDelivery(
                integration_id=integration.id,
                event="task.created",
                payload={},
                request_url="http://x",
                request_headers={"Authorization": "Bearer secret"},
            )
        )
        db.commit()

    def test_deleting_a_container_leaves_nothing_filed_under_it(self, client, db):
        p = _project(client, "P")
        t = _task(client, p, "T")
        self._fill(db, p, t)
        assert any(self._side_rows(db, p, t).values()), "the fixture must actually write rows"

        assert client.delete(f"/api/nodes/{p}").status_code == 204

        db.expire_all()
        assert self._side_rows(db, p, t) == dict.fromkeys(self._side_rows(db, p, t), 0)

    def test_a_delete_does_not_erase_the_history_of_what_happened(self, client, db):
        """ADR-0073's rule: retiring a subject must not retire its history."""
        from app.models import ActivityLog, GraphEvent

        p = _project(client, "P")
        _task(client, p, "T")
        assert client.delete(f"/api/nodes/{p}").status_code == 204

        db.expire_all()
        assert db.query(ActivityLog).filter_by(project_id=p).count() > 0
        assert db.query(GraphEvent).filter_by(node_id=p).count() > 0
