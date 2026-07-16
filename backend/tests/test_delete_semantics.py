"""Delete semantics under the graph model (ADR-0032, no-primary multi-container).

Deleting a task removes its subtask tree; deleting a project removes the tasks it
exclusively owns but keeps tasks also linked into another project. These replace the
old ``project_id``/``parent_id`` FK ``ondelete CASCADE`` + ORM ``delete-orphan``.
"""

from app.models import Task


def _project(client, name):
    return client.post("/projects", json={"name": name}).json()["id"]


def _task(client, project_id, title, parent_id=None):
    body = {"title": title}
    if parent_id:
        body["parent_id"] = parent_id
    return client.post(f"/projects/{project_id}/tasks", json=body).json()["id"]


def test_delete_task_cascades_subtasks(client, db):
    p = _project(client, "P")
    parent = _task(client, p, "parent")
    sub = _task(client, p, "sub", parent_id=parent)
    subsub = _task(client, p, "subsub", parent_id=sub)

    assert client.delete(f"/projects/{p}/tasks/{parent}").status_code == 204

    # The whole subtree is gone.
    assert db.get(Task, parent) is None
    assert db.get(Task, sub) is None
    assert db.get(Task, subsub) is None


def test_delete_project_deletes_its_tasks(client, db):
    p = _project(client, "P")
    parent = _task(client, p, "parent")
    sub = _task(client, p, "sub", parent_id=parent)

    assert client.delete(f"/projects/{p}").status_code == 204

    assert db.get(Task, parent) is None
    assert db.get(Task, sub) is None


def test_delete_project_keeps_task_shared_with_another(client, db):
    a = _project(client, "A")
    b = _project(client, "B")
    t = _task(client, a, "shared")
    assert client.post(f"/projects/{a}/tasks/{t}/memberships/{b}").status_code == 201

    assert client.delete(f"/projects/{a}").status_code == 204

    # The task survives because it is still linked into project B.
    assert db.get(Task, t) is not None
    proj_b = client.get(f"/projects/{b}").json()
    assert t in [x["id"] for x in proj_b["tasks"]]


def test_delete_project_keeps_subtask_shared_with_another(client, db):
    a = _project(client, "A")
    b = _project(client, "B")
    parent = _task(client, a, "parent")
    sub = _task(client, a, "sub", parent_id=parent)
    subsub = _task(client, a, "subsub", parent_id=sub)
    assert client.post(f"/projects/{a}/tasks/{sub}/memberships/{b}").status_code == 201

    assert client.delete(f"/projects/{a}").status_code == 204

    # The exclusively-owned parent dies; the shared subtask survives with its own subtree.
    assert db.get(Task, parent) is None
    assert db.get(Task, sub) is not None
    assert db.get(Task, subsub) is not None
    proj_b = client.get(f"/projects/{b}").json()
    ids = [x["id"] for x in proj_b["tasks"]]
    assert sub in ids
    # Its old parent is gone, so it surfaces as a top-level task in B.
    by_id = {x["id"]: x for x in proj_b["tasks"]}
    assert by_id[sub]["parent_id"] is None


def test_delete_task_keeps_subtask_shared_with_another_project(client, db):
    a = _project(client, "A")
    b = _project(client, "B")
    parent = _task(client, a, "parent")
    sub = _task(client, a, "sub", parent_id=parent)
    assert client.post(f"/projects/{a}/tasks/{sub}/memberships/{b}").status_code == 201

    assert client.delete(f"/projects/{a}/tasks/{parent}").status_code == 204

    # The shared subtask survives in B and fully leaves the deleted tree's project.
    assert db.get(Task, parent) is None
    assert db.get(Task, sub) is not None
    proj_a = client.get(f"/projects/{a}").json()
    assert sub not in [x["id"] for x in proj_a["tasks"]]
    proj_b = client.get(f"/projects/{b}").json()
    assert sub in [x["id"] for x in proj_b["tasks"]]
