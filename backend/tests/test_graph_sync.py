"""The before_flush listener mirrors association tables into edges (ADR-0032)."""

from app.models import (
    Cycle,
    CycleTask,
    Edge,
    Goal,
    GoalProject,
    Identity,
    Label,
    Project,
    ProjectIdentity,
    Task,
    TaskDependency,
    TaskLabel,
)


def _edge(db, source_id, target_id, rel_type):
    return (
        db.query(Edge)
        .filter(Edge.source_id == source_id, Edge.target_id == target_id, Edge.rel_type == rel_type)
        .first()
    )


def _project(db):
    p = Project(name="p")
    db.add(p)
    db.flush()
    return p


def _task(db, project_id, title="t"):
    t = Task(project_id=project_id, title=title)
    db.add(t)
    db.flush()
    return t


def test_task_label_mirrored(db):
    p = _project(db)
    t = _task(db, p.id)
    label = Label(project_id=p.id, name="bug")
    db.add(label)
    db.flush()

    db.add(TaskLabel(task_id=t.id, label_id=label.id))
    db.commit()
    assert _edge(db, t.id, label.id, "labeled") is not None

    db.delete(db.query(TaskLabel).first())
    db.commit()
    assert _edge(db, t.id, label.id, "labeled") is None


def test_task_dependency_mirrored(db):
    p = _project(db)
    a = _task(db, p.id, "a")
    b = _task(db, p.id, "b")

    db.add(TaskDependency(task_id=a.id, depends_on_id=b.id))
    db.commit()
    assert _edge(db, a.id, b.id, "depends_on") is not None

    db.delete(db.query(TaskDependency).first())
    db.commit()
    assert _edge(db, a.id, b.id, "depends_on") is None


def test_cycle_task_mirrored(db):
    p = _project(db)
    t = _task(db, p.id)
    cycle = Cycle(project_id=p.id, name="sprint")
    db.add(cycle)
    db.flush()

    db.add(CycleTask(cycle_id=cycle.id, task_id=t.id))
    db.commit()
    assert _edge(db, t.id, cycle.id, "in_cycle") is not None


def test_project_identity_mirrored(db):
    p = _project(db)
    ident = Identity(name="me")
    db.add(ident)
    db.flush()

    db.add(ProjectIdentity(project_id=p.id, identity_id=ident.id))
    db.commit()
    assert _edge(db, ident.id, p.id, "member_of") is not None


def test_goal_project_mirrored(db):
    p = _project(db)
    goal = Goal(title="ship it")
    db.add(goal)
    db.flush()

    db.add(GoalProject(goal_id=goal.id, project_id=p.id))
    db.commit()
    assert _edge(db, p.id, goal.id, "part_of") is not None


def test_nodes_lazily_created_for_association(db):
    from app.models import Node

    p = _project(db)
    t = _task(db, p.id)
    label = Label(project_id=p.id, name="x")
    db.add(label)
    db.flush()
    db.add(TaskLabel(task_id=t.id, label_id=label.id))
    db.commit()

    # Both endpoints now exist as nodes with the correct type.
    assert db.get(Node, t.id).type == "task"
    assert db.get(Node, label.id).type == "label"
