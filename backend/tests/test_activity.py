from app.models import ActivityLog
from app.services.activity import log_activity


def test_log_activity_creates_entry(db):
    entry = log_activity(
        db,
        "test.action",
        project_id="proj-1",
        actor="tester",
        detail="Test activity",
    )
    assert entry.id is not None
    assert entry.action == "test.action"
    assert entry.actor == "tester"


def test_log_activity_flushes_not_commits(db):
    log_activity(db, "test.flush", actor="tester")
    # Entry should be in session (flushed) but not committed
    assert len(db.new) == 0  # flushed means moved out of `new`
    found = db.query(ActivityLog).filter(ActivityLog.action == "test.flush").first()
    assert found is not None
    # Rolling back should remove it since it was not committed
    db.rollback()
    found = db.query(ActivityLog).filter(ActivityLog.action == "test.flush").first()
    assert found is None
