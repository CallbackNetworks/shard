"""Tests for critical path analysis service."""

from app.services import graph
from app.services.critical_path import compute_critical_path
from tests.factories import make_project, make_task


class TestCriticalPath:
    def _make_project(self, db):
        p = make_project(db, name="CP Project")
        db.add(p)
        db.flush()
        return p

    def _make_task(self, db, project_id, title, time_estimate=None, status="todo"):
        t = make_task(db, project_id=project_id, title=title, status=status, time_estimate=time_estimate)
        db.add(t)
        db.flush()
        return t

    def _add_dep(self, db, task_id, depends_on_id):
        graph.add_edge(db, task_id, depends_on_id, graph.REL_DEPENDS_ON)
        db.flush()

    def test_linear_chain(self, db):
        """A -> B -> C: critical path should be [A, B, C]."""
        p = self._make_project(db)
        a = self._make_task(db, p.id, "A", time_estimate=30)
        b = self._make_task(db, p.id, "B", time_estimate=20)
        c = self._make_task(db, p.id, "C", time_estimate=10)

        # B depends on A, C depends on B
        self._add_dep(db, b.id, a.id)
        self._add_dep(db, c.id, b.id)
        db.commit()

        result = compute_critical_path(db, p.id)

        assert "error" not in result
        assert result["critical_path"] == [a.id, b.id, c.id]
        assert result["total_duration_minutes"] == 60  # 30 + 20 + 10

        # All tasks should have zero slack in a linear chain
        for tid in [a.id, b.id, c.id]:
            assert result["tasks"][tid]["slack"] == 0

    def test_diamond_uses_longer_branch(self, db):
        """Diamond: A -> B, A -> C, B -> D, C -> D.
        If B takes longer than C, critical path goes through B.
        """
        p = self._make_project(db)
        a = self._make_task(db, p.id, "A", time_estimate=10)
        b = self._make_task(db, p.id, "B", time_estimate=50)  # longer
        c = self._make_task(db, p.id, "C", time_estimate=20)  # shorter
        d = self._make_task(db, p.id, "D", time_estimate=10)

        # B and C depend on A; D depends on B and C
        self._add_dep(db, b.id, a.id)
        self._add_dep(db, c.id, a.id)
        self._add_dep(db, d.id, b.id)
        self._add_dep(db, d.id, c.id)
        db.commit()

        result = compute_critical_path(db, p.id)

        assert "error" not in result
        # Critical path: A -> B -> D (longest path = 10 + 50 + 10 = 70)
        assert a.id in result["critical_path"]
        assert b.id in result["critical_path"]
        assert d.id in result["critical_path"]
        assert c.id not in result["critical_path"]
        assert result["total_duration_minutes"] == 70

        # C should have positive slack
        assert result["tasks"][c.id]["slack"] > 0
        # A, B, D should have zero slack
        assert result["tasks"][a.id]["slack"] == 0
        assert result["tasks"][b.id]["slack"] == 0
        assert result["tasks"][d.id]["slack"] == 0

    def test_single_task_no_deps(self, db):
        """Single task with no dependencies: critical path is just that task."""
        p = self._make_project(db)
        t = self._make_task(db, p.id, "Solo", time_estimate=45)
        db.commit()

        result = compute_critical_path(db, p.id)

        assert "error" not in result
        assert result["critical_path"] == [t.id]
        assert result["total_duration_minutes"] == 45
        assert result["tasks"][t.id]["slack"] == 0

    def test_empty_project(self, db):
        """Empty project (no tasks): empty critical path."""
        p = self._make_project(db)
        db.commit()

        result = compute_critical_path(db, p.id)

        assert "error" not in result
        assert result["critical_path"] == []
        assert result["total_duration_minutes"] == 0

    def test_cycle_detection(self, db):
        """Cycle: A -> B -> A should return error."""
        p = self._make_project(db)
        a = self._make_task(db, p.id, "A", time_estimate=30)
        b = self._make_task(db, p.id, "B", time_estimate=20)

        # B depends on A, A depends on B (cycle)
        self._add_dep(db, b.id, a.id)
        self._add_dep(db, a.id, b.id)
        db.commit()

        result = compute_critical_path(db, p.id)

        assert result["error"] == "Dependency cycle detected"
        assert result["critical_path"] == []

    def test_default_duration_when_no_estimate(self, db):
        """Tasks without time_estimate default to 60 minutes."""
        p = self._make_project(db)
        t = self._make_task(db, p.id, "No Estimate", time_estimate=None)
        db.commit()

        result = compute_critical_path(db, p.id)

        assert result["tasks"][t.id]["duration"] == 60
        assert result["total_duration_minutes"] == 60

    def test_excludes_done_and_failed_tasks(self, db):
        """Done and failed tasks should be excluded from the analysis."""
        p = self._make_project(db)
        a = self._make_task(db, p.id, "Active", time_estimate=30)
        self._make_task(db, p.id, "Done", time_estimate=100, status="done")
        self._make_task(db, p.id, "Failed", time_estimate=100, status="failed")
        db.commit()

        result = compute_critical_path(db, p.id)

        assert len(result["tasks"]) == 1
        assert result["critical_path"] == [a.id]
        assert result["total_duration_minutes"] == 30

    def test_parallel_independent_tasks(self, db):
        """Two independent tasks: both are on the critical path since they have same duration."""
        p = self._make_project(db)
        a = self._make_task(db, p.id, "A", time_estimate=30)
        b = self._make_task(db, p.id, "B", time_estimate=30)
        db.commit()

        result = compute_critical_path(db, p.id)

        # Both have zero slack (no dependencies, both start at 0, both end at 30 = project duration)
        assert result["tasks"][a.id]["slack"] == 0
        assert result["tasks"][b.id]["slack"] == 0
        assert result["total_duration_minutes"] == 30


class TestCriticalPathEndpoint:
    def test_endpoint_returns_result(self, client, db):
        p = make_project(db, name="EP Test")
        db.add(p)
        db.flush()
        t = make_task(db, project_id=p.id, title="Task", status="todo", time_estimate=30)
        db.add(t)
        db.commit()

        resp = client.get(f"/api/analytics/critical-path/{p.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert "critical_path" in data
        assert t.id in data["critical_path"]

    def test_endpoint_nonexistent_project(self, client, db):
        resp = client.get("/api/analytics/critical-path/nonexistent-id")
        assert resp.status_code == 200
        data = resp.json()
        assert data["critical_path"] == []
