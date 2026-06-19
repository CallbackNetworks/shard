from unittest.mock import patch

from app.models import Task


def _make_task(db, project_id):
    t = Task(project_id=project_id, title="Attachment test task", status="todo")
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _url(project_id, task_id, suffix=""):
    return f"/projects/{project_id}/tasks/{task_id}/attachments{suffix}"


# --- 1. List attachments on a fresh task ---


def test_list_attachments_empty(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    r = client.get(_url(sample_project.id, task.id))
    assert r.status_code == 200
    assert r.json() == []


# --- 2. Upload attachment ---


def test_upload_attachment(client, db, sample_project, tmp_path):
    task = _make_task(db, sample_project.id)

    with patch("app.routers.attachments.UPLOAD_DIR", tmp_path):
        r = client.post(
            _url(sample_project.id, task.id),
            files={"file": ("test.txt", b"hello world", "text/plain")},
        )
    assert r.status_code == 201
    data = r.json()
    assert data["filename"] == "test.txt"
    assert data["task_id"] == task.id
    assert data["project_id"] == sample_project.id
    assert "id" in data


# --- 3. List after upload ---


def test_list_after_upload(client, db, sample_project, tmp_path):
    task = _make_task(db, sample_project.id)

    with patch("app.routers.attachments.UPLOAD_DIR", tmp_path):
        client.post(
            _url(sample_project.id, task.id),
            files={"file": ("readme.md", b"# Hello", "text/markdown")},
        )

    r = client.get(_url(sample_project.id, task.id))
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["filename"] == "readme.md"


# --- 4. Upload attachment fields ---


def test_upload_attachment_fields(client, db, sample_project, tmp_path):
    task = _make_task(db, sample_project.id)
    content = b"some binary data here"

    with patch("app.routers.attachments.UPLOAD_DIR", tmp_path):
        r = client.post(
            _url(sample_project.id, task.id),
            files={"file": ("data.bin", content, "application/octet-stream")},
        )
    assert r.status_code == 201
    data = r.json()
    assert data["filename"] == "data.bin"
    assert data["content_type"] == "application/octet-stream"
    assert data["size"] == len(content)
    assert "created_at" in data


# --- 5. Download attachment ---


def test_download_attachment(client, db, sample_project, tmp_path):
    task = _make_task(db, sample_project.id)
    file_content = b"download me please"

    with patch("app.routers.attachments.UPLOAD_DIR", tmp_path):
        upload_r = client.post(
            _url(sample_project.id, task.id),
            files={"file": ("dl.txt", file_content, "text/plain")},
        )
    attachment_id = upload_r.json()["id"]

    r = client.get(_url(sample_project.id, task.id, f"/{attachment_id}/download"))
    assert r.status_code == 200
    assert r.content == file_content


# --- 6. Delete attachment ---


def test_delete_attachment(client, db, sample_project, tmp_path):
    task = _make_task(db, sample_project.id)

    with patch("app.routers.attachments.UPLOAD_DIR", tmp_path):
        upload_r = client.post(
            _url(sample_project.id, task.id),
            files={"file": ("remove.txt", b"bye", "text/plain")},
        )
    attachment_id = upload_r.json()["id"]

    r = client.delete(_url(sample_project.id, task.id, f"/{attachment_id}"))
    assert r.status_code == 204

    # Verify it is gone
    listing = client.get(_url(sample_project.id, task.id))
    assert listing.json() == []


# --- 7. Upload to nonexistent task ---


def test_upload_to_nonexistent_task(client, db, sample_project, tmp_path):
    with patch("app.routers.attachments.UPLOAD_DIR", tmp_path):
        r = client.post(
            _url(sample_project.id, "nonexistent-task-id"),
            files={"file": ("test.txt", b"data", "text/plain")},
        )
    assert r.status_code == 404


# --- 8. Delete nonexistent attachment ---


def test_delete_nonexistent_attachment(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    r = client.delete(_url(sample_project.id, task.id, "/nonexistent-att-id"))
    assert r.status_code == 404
