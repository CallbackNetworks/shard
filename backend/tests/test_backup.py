import io
import json
import zipfile

import pytest

from app.models import Comment, Edge, Node
from app.services import backup as backup_service
from app.services import graph
from tests.factories import make_task


def _make_backup_file(tmp_path, name):
    (tmp_path / name).write_bytes(b"fake")


def test_export_backup_contains_all_data(client, db, sample_project):
    task = make_task(db, project_id=sample_project.id, title="Backed up task", status="todo")
    db.add(task)
    db.commit()

    resp = client.get("/backup/export")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    assert "attachment" in resp.headers["content-disposition"]

    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        names = zf.namelist()
        assert "meta.json" in names
        assert "data.json" in names
        meta = json.loads(zf.read("meta.json"))
        assert meta["format_version"] == 1
        data = json.loads(zf.read("data.json"))

    # Tasks are node-only now (ADR-0033 B5): there is no ``tasks`` table; they ride
    # in the ``nodes`` table with type "task".
    assert "tasks" not in data
    assert {n["title"] for n in data["nodes"] if n["type"] == "task"} == {"Backed up task"}
    assert {p["name"] for p in data["projects"]} == {sample_project.name}
    assert "webhook_deliveries" in data


def test_run_and_status_roundtrip(client, db, sample_project, tmp_path, monkeypatch):
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path))

    resp = client.post("/backup/run")
    assert resp.status_code == 200
    body = resp.json()
    assert body["filename"].startswith("shard-backup-")
    assert body["size_bytes"] > 0
    assert (tmp_path / body["filename"]).is_file()

    resp = client.get("/backup/status")
    assert resp.status_code == 200
    status = resp.json()
    assert status["enabled"] is True
    assert status["keep"] == 7
    assert [b["filename"] for b in status["backups"]] == [body["filename"]]


def test_download_existing_backup(client, db, tmp_path, monkeypatch):
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path))
    created = client.post("/backup/run").json()["filename"]

    resp = client.get(f"/backup/download/{created}")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"

    assert client.get("/backup/download/shard-backup-19990101-000000.zip").status_code == 404
    # Encoded traversal never reaches the handler (path params reject slashes)
    assert client.get("/backup/download/..%2Fshard.db").status_code == 404
    assert client.get("/backup/download/evil.zip").status_code == 400


def test_prune_backups_keeps_newest(tmp_path):
    for i in range(5):
        _make_backup_file(tmp_path, f"shard-backup-2026010{i + 1}-000000.zip")
    _make_backup_file(tmp_path, "unrelated.zip")

    removed = backup_service.prune_backups(2, dest_dir=tmp_path)
    assert removed == 3

    remaining = sorted(p.name for p in tmp_path.glob("shard-backup-*.zip"))
    assert remaining == [
        "shard-backup-20260104-000000.zip",
        "shard-backup-20260105-000000.zip",
    ]
    # Non-backup files are never touched
    assert (tmp_path / "unrelated.zip").is_file()


def test_prune_backups_never_deletes_below_one(tmp_path):
    _make_backup_file(tmp_path, "shard-backup-20260101-000000.zip")
    removed = backup_service.prune_backups(0, dest_dir=tmp_path)
    assert removed == 0
    assert (tmp_path / "shard-backup-20260101-000000.zip").is_file()


def test_restore_roundtrip_recovers_wiped_data(client, db, sample_project):
    parent = make_task(db, project_id=sample_project.id, title="Parent task", status="todo")
    db.add(parent)
    db.flush()
    child = make_task(
        db,
        project_id=sample_project.id,
        parent_id=parent.id,
        title="Child task",
        status="in_progress",
    )
    db.add(child)
    db.flush()
    db.add(Comment(task_id=parent.id, body="a note"))
    db.commit()
    parent_id = parent.id

    archive = client.get("/backup/export").content

    # Simulate operator error: wipe everything (tasks are node-only, ADR-0033).
    db.query(Comment).delete()
    db.query(Edge).delete()
    db.query(Node).delete()
    db.commit()
    assert db.query(Node).filter(Node.type == "task").count() == 0

    resp = client.post(
        "/backup/restore",
        files={"file": ("backup.zip", archive, "application/zip")},
        data={"confirm": "replace"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["table_counts"]["comments"] == 1

    db.expire_all()
    titles = {n.title for n in db.query(Node).filter(Node.type == "task").all()}
    assert titles == {"Parent task", "Child task"}
    # Parent link (a contains edge, ADR-0032) survives the restore.
    restored_child = db.query(Node).filter(Node.type == "task", Node.title == "Child task").one()
    assert graph.parent_task_map(db, [restored_child.id]).get(restored_child.id) == parent_id
    assert db.query(Comment).count() == 1


def test_restore_requires_confirm(client, sample_project):
    archive = client.get("/backup/export").content
    resp = client.post(
        "/backup/restore",
        files={"file": ("backup.zip", archive, "application/zip")},
    )
    assert resp.status_code == 400


def test_restore_rejects_non_zip(client):
    resp = client.post(
        "/backup/restore",
        files={"file": ("backup.zip", b"not a zip", "application/zip")},
        data={"confirm": "replace"},
    )
    assert resp.status_code == 422


def test_restore_rejects_bad_format_version(client):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("meta.json", json.dumps({"format_version": 999}))
        zf.writestr("data.json", json.dumps({}))
    resp = client.post(
        "/backup/restore",
        files={"file": ("backup.zip", buf.getvalue(), "application/zip")},
        data={"confirm": "replace"},
    )
    assert resp.status_code == 422


def test_restore_uploads_blocks_zip_slip(tmp_path):
    uploads = tmp_path / "uploads"
    outside = tmp_path / "outside.txt"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("uploads/safe.txt", b"ok")
        zf.writestr("uploads/../outside.txt", b"pwned")
    with zipfile.ZipFile(io.BytesIO(buf.getvalue())) as zf:
        written = backup_service.restore_uploads(zf, upload_dir=uploads)
    # Only the safe entry is written; the traversal entry is skipped.
    assert written == 1
    assert (uploads / "safe.txt").read_bytes() == b"ok"
    assert not outside.exists()


def test_restore_rejects_unknown_table(client, db):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("meta.json", json.dumps({"format_version": 1}))
        zf.writestr("data.json", json.dumps({"not_a_real_table": []}))
    with pytest.raises(backup_service.RestoreError):
        backup_service.restore_archive(db, buf.getvalue())
