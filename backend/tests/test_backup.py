import io
import json
import zipfile

from app.models import Task
from app.services import backup as backup_service


def _make_backup_file(tmp_path, name):
    (tmp_path / name).write_bytes(b"fake")


def test_export_backup_contains_all_data(client, db, sample_project):
    task = Task(project_id=sample_project.id, title="Backed up task", status="todo")
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
        assert meta["table_counts"]["tasks"] == 1
        data = json.loads(zf.read("data.json"))

    assert {t["title"] for t in data["tasks"]} == {"Backed up task"}
    assert {p["name"] for p in data["projects"]} == {sample_project.name}
    # Every ORM table is present in the dump, even when empty
    assert "labels" in data
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
