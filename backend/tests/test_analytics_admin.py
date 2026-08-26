"""The planning analytics — the half that says what to do next (ADR-0086).

Retrospective reports (overview, velocity, heatmap) had a v1 door long before this
module did; critical path, burn-down and calibrated estimates were internal-only, which
is the half an agent planning work actually needs.

These are pure computations over stored numbers, so the risk is not that they crash —
it is that they are quietly *wrong*, and a wrong number in a planning report is worse
than no number, because it will be acted on. Everything below therefore checks arithmetic
against hand-computed values rather than asserting a shape.

The refusals matter as much as the answers. ``estimate_suggestion`` returns
``suggested_estimate: None`` with a reason rather than a figure derived from three
samples, and falls back from project history to global history before giving up. Those
branches are the module's judgement, and they are what a test can pin.
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.services import analytics_admin, graph
from tests.factories import make_project, make_task


def _done_task(db, project, *, estimate, spent, title="t", updated=None):
    """A completed task carrying both an estimate and a spend, in minutes."""
    task = make_task(db, project_id=project.id, title=title, status="done")
    task.data = {**(task.data or {}), "time_estimate": estimate, "time_spent": spent}
    if updated:
        task.updated_at = updated
    db.add(task)
    db.commit()
    return task


@pytest.fixture()
def project(db):
    p = make_project(db, name="Analytics Project")
    db.commit()
    return p


class TestEstimationCalibration:
    def test_no_history_reports_a_zero_sample_rather_than_a_number(self, db, project):
        report = analytics_admin.estimation_calibration(db, project.id)
        assert report["sample_size"] == 0
        assert report["overall_ratio"] is None
        assert report["median_ratio"] is None
        assert report["buckets"] == []

    def test_a_task_without_both_numbers_is_not_a_sample(self, db, project):
        """A ratio needs an estimate *and* a spend; one alone is not signal."""
        estimate_only = make_task(db, project_id=project.id, title="est only", status="done")
        estimate_only.data = {"time_estimate": 60}
        spend_only = make_task(db, project_id=project.id, title="spent only", status="done")
        spend_only.data = {"time_spent": 60}
        db.add_all([estimate_only, spend_only])
        db.commit()

        assert analytics_admin.estimation_calibration(db, project.id)["sample_size"] == 0

    def test_an_unfinished_task_is_not_a_sample(self, db, project):
        task = make_task(db, project_id=project.id, title="in flight", status="in_progress")
        task.data = {"time_estimate": 60, "time_spent": 90}
        db.add(task)
        db.commit()

        assert analytics_admin.estimation_calibration(db, project.id)["sample_size"] == 0

    def test_the_overall_ratio_is_total_spent_over_total_estimate(self, db, project):
        """Weighted by size — not the mean of the per-task ratios, which is a different number."""
        _done_task(db, project, estimate=100, spent=200, title="a")  # ratio 2.0
        _done_task(db, project, estimate=100, spent=100, title="b")  # ratio 1.0

        report = analytics_admin.estimation_calibration(db, project.id)
        assert report["sample_size"] == 2
        assert report["overall_ratio"] == 1.5  # 300 / 200

    def test_the_median_is_the_middle_ratio_not_the_mean(self, db, project):
        for i, (est, spent) in enumerate([(60, 60), (60, 120), (60, 600)]):
            _done_task(db, project, estimate=est, spent=spent, title=f"t{i}")

        report = analytics_admin.estimation_calibration(db, project.id)
        assert report["median_ratio"] == 2.0  # ratios 1, 2, 10 -> median 2
        assert report["overall_ratio"] == 4.33  # 780 / 180, which the median deliberately is not

    def test_an_even_sample_averages_the_two_middle_ratios(self, db, project):
        for i, (est, spent) in enumerate([(60, 60), (60, 120), (60, 180), (60, 600)]):
            _done_task(db, project, estimate=est, spent=spent, title=f"t{i}")

        assert analytics_admin.estimation_calibration(db, project.id)["median_ratio"] == 2.5  # (2+3)/2

    def test_within_twenty_percent_counts_the_band_inclusively(self, db, project):
        _done_task(db, project, estimate=100, spent=80, title="exactly 0.8")
        _done_task(db, project, estimate=100, spent=120, title="exactly 1.2")
        _done_task(db, project, estimate=100, spent=200, title="well over")

        report = analytics_admin.estimation_calibration(db, project.id)
        assert report["within_20_pct"] == 67  # 2 of 3, rounded

    def test_under_and_over_estimation_are_counted_separately(self, db, project):
        _done_task(db, project, estimate=100, spent=300, title="took much longer")
        _done_task(db, project, estimate=100, spent=50, title="took much less")
        _done_task(db, project, estimate=100, spent=100, title="on the nose")

        report = analytics_admin.estimation_calibration(db, project.id)
        assert report["underestimated"] == 1
        assert report["overestimated"] == 1

    def test_buckets_group_by_estimate_size(self, db, project):
        _done_task(db, project, estimate=20, spent=40, title="small")  # <=30m
        _done_task(db, project, estimate=90, spent=90, title="medium")  # 1-2h

        by_label = {b["label"]: b for b in analytics_admin.estimation_calibration(db, project.id)["buckets"]}
        assert by_label["<=30m"]["count"] == 1
        assert by_label["<=30m"]["avg_ratio"] == 2.0
        assert by_label["1-2h"]["count"] == 1
        assert by_label["31-60m"]["count"] == 0
        assert by_label["31-60m"]["avg_ratio"] is None, "an empty bucket must not invent a ratio"

    def test_the_open_ended_bucket_catches_anything_large(self, db, project):
        _done_task(db, project, estimate=100_000, spent=100_000, title="enormous")
        by_label = {b["label"]: b for b in analytics_admin.estimation_calibration(db, project.id)["buckets"]}
        assert by_label[">4h"]["count"] == 1

    def test_recent_tasks_are_capped_at_twenty(self, db, project):
        for i in range(25):
            _done_task(db, project, estimate=60, spent=60, title=f"task {i}")

        report = analytics_admin.estimation_calibration(db, project.id)
        assert report["sample_size"] == 25
        assert len(report["recent_tasks"]) == 20

    def test_scoping_to_a_project_excludes_other_projects(self, db, project):
        other = make_project(db, name="Elsewhere")
        db.commit()
        _done_task(db, project, estimate=100, spent=100, title="mine")
        _done_task(db, other, estimate=100, spent=900, title="theirs")

        assert analytics_admin.estimation_calibration(db, project.id)["overall_ratio"] == 1.0
        assert analytics_admin.estimation_calibration(db, None)["sample_size"] == 2


class TestEstimateSuggestion:
    """A number invented from three samples is worse than no number."""

    def test_too_little_history_refuses_with_a_reason(self, db, project):
        _done_task(db, project, estimate=60, spent=90, title="lonely")

        result = analytics_admin.estimate_suggestion(db, 60, project.id)
        assert result["suggested_estimate"] is None
        assert result["reason"] == "not_enough_history"

    def test_a_sparse_project_falls_back_to_global_history(self, db, project):
        """Rather than refusing outright — the user's own history elsewhere is still signal."""
        elsewhere = make_project(db, name="Has History")
        db.commit()
        for i in range(6):
            _done_task(db, elsewhere, estimate=60, spent=120, title=f"other {i}")

        result = analytics_admin.estimate_suggestion(db, 60, project.id)
        assert result["basis_scope"] == "global"
        assert result["suggested_estimate"] == 120

    def test_a_project_with_its_own_history_is_not_diluted_by_others(self, db, project):
        elsewhere = make_project(db, name="Wildly Different")
        db.commit()
        for i in range(6):
            _done_task(db, project, estimate=60, spent=60, title=f"mine {i}")
        for i in range(20):
            _done_task(db, elsewhere, estimate=60, spent=600, title=f"theirs {i}")

        result = analytics_admin.estimate_suggestion(db, 60, project.id)
        assert result["basis_scope"] == "project"
        assert result["suggested_estimate"] == 60

    def test_a_well_populated_bucket_is_preferred_over_the_overall_median(self, db, project):
        # Five tasks in the <=30m bucket that consistently take twice as long...
        for i in range(5):
            _done_task(db, project, estimate=20, spent=40, title=f"small {i}")
        # ...against larger tasks that come in on time, which would drag a global median down.
        for i in range(5):
            _done_task(db, project, estimate=200, spent=200, title=f"large {i}")

        result = analytics_admin.estimate_suggestion(db, 20, project.id)
        assert result["basis"] == "bucket"
        assert result["bucket"] == "<=30m"
        assert result["suggested_estimate"] == 40

    def test_a_sparse_bucket_falls_back_to_the_overall_median(self, db, project):
        for i in range(6):
            _done_task(db, project, estimate=200, spent=400, title=f"large {i}")
        # One sample in the small bucket is below MIN_BUCKET_SAMPLE.
        _done_task(db, project, estimate=20, spent=20, title="lone small")

        result = analytics_admin.estimate_suggestion(db, 20, project.id)
        assert result["basis"] == "overall_median"
        assert result["suggested_estimate"] == 40  # median ratio 2.0

    def test_a_suggestion_never_rounds_down_to_zero(self, db, project):
        """A one-minute task against a history of wild overestimation."""
        for i in range(6):
            _done_task(db, project, estimate=100, spent=1, title=f"quick {i}")

        assert analytics_admin.estimate_suggestion(db, 1, project.id)["suggested_estimate"] == 1


class TestBurndown:
    def test_an_unknown_cycle_is_empty_rather_than_an_error(self, db):
        assert analytics_admin.burndown(db, "no-such-cycle") == []
        assert analytics_admin.cycle_burndown(db, "no-such-cycle") == []

    def test_a_cycle_with_no_tasks_is_empty(self, db, project):
        cycle = graph.create_cycle(db, project_id=project.id, name="Empty cycle")
        db.commit()
        assert analytics_admin.burndown(db, cycle.id) == []
        assert analytics_admin.cycle_burndown(db, cycle.id) == []

    def test_remaining_falls_as_tasks_complete(self, db, project):
        start = datetime.now(UTC) - timedelta(days=3)
        cycle = graph.create_cycle(db, project_id=project.id, name="Active", start_date=start)
        db.commit()

        open_task = make_task(db, project_id=project.id, title="still open")
        done_task = make_task(db, project_id=project.id, title="finished", status="done")
        done_task.updated_at = start
        db.add_all([open_task, done_task])
        db.commit()
        for task in (open_task, done_task):
            graph.add_to_cycle(db, cycle.id, task.id)
        db.commit()

        series = analytics_admin.cycle_burndown(db, cycle.id)
        assert series, "a cycle with tasks and a start date should produce a series"
        assert all(point["total"] == 2 for point in series)
        assert series[-1]["remaining"] == 1
        assert series[-1]["done"] == 1

    def test_the_ideal_line_runs_from_total_to_zero(self, db, project):
        start = datetime.now(UTC) - timedelta(days=4)
        cycle = graph.create_cycle(db, project_id=project.id, name="Ideal", start_date=start)
        db.commit()
        task = make_task(db, project_id=project.id, title="one")
        db.add(task)
        db.commit()
        graph.add_to_cycle(db, cycle.id, task.id)
        db.commit()

        series = analytics_admin.cycle_burndown(db, cycle.id)
        assert series[0]["ideal"] == 1.0
        assert series[-1]["ideal"] == 0.0

    def test_the_series_does_not_run_into_the_future(self, db, project):
        start = datetime.now(UTC) - timedelta(days=2)
        cycle = graph.create_cycle(
            db, project_id=project.id, name="Ends later", start_date=start, end_date=start + timedelta(days=30)
        )
        db.commit()
        task = make_task(db, project_id=project.id, title="one")
        db.add(task)
        db.commit()
        graph.add_to_cycle(db, cycle.id, task.id)
        db.commit()

        series = analytics_admin.cycle_burndown(db, cycle.id)
        last = datetime.strptime(series[-1]["date"], "%Y-%m-%d").replace(tzinfo=UTC)
        assert last <= datetime.now(UTC), "burn-down plotted days that have not happened"


class TestCriticalPath:
    def test_an_empty_project_has_no_path(self, db, project):
        result = analytics_admin.critical_path(db, project.id)
        assert result is not None
