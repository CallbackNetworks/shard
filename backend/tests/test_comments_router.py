from tests.factories import make_task


def _url(project_id, task_id, suffix=""):
    return f"/projects/{project_id}/tasks/{task_id}/comments{suffix}"


def _make_task(db, project_id):
    t = make_task(db, project_id=project_id, title="Test task", status="todo")
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


# --- 1. List comments on a fresh task ---


def test_list_comments_empty(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    r = client.get(_url(sample_project.id, task.id))
    assert r.status_code == 200
    assert r.json() == []


# --- 2. Create a comment ---


def test_create_comment(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    r = client.post(
        _url(sample_project.id, task.id),
        json={"author": "Alice", "body": "Looks good!"},
    )
    assert r.status_code == 201
    data = r.json()
    assert data["author"] == "Alice"
    assert data["body"] == "Looks good!"
    assert data["task_id"] == task.id
    assert data["project_id"] == sample_project.id
    assert "id" in data
    assert "created_at" in data
    assert "updated_at" in data


# --- 3. List comments after creating one ---


def test_list_comments_after_create(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    client.post(
        _url(sample_project.id, task.id),
        json={"author": "Bob", "body": "First comment"},
    )
    r = client.get(_url(sample_project.id, task.id))
    assert r.status_code == 200
    comments = r.json()
    assert len(comments) == 1
    assert comments[0]["body"] == "First comment"
    assert comments[0]["author"] == "Bob"


# --- 4. Update a comment ---


def test_update_comment(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    create_r = client.post(
        _url(sample_project.id, task.id),
        json={"author": "Carol", "body": "Original text"},
    )
    comment_id = create_r.json()["id"]

    r = client.patch(
        _url(sample_project.id, task.id, f"/{comment_id}"),
        json={"body": "Updated text"},
    )
    assert r.status_code == 200
    assert r.json()["body"] == "Updated text"
    assert r.json()["author"] == "Carol"


# --- 5. Delete a comment ---


def test_delete_comment(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    create_r = client.post(
        _url(sample_project.id, task.id),
        json={"author": "Dave", "body": "To be deleted"},
    )
    comment_id = create_r.json()["id"]

    r = client.delete(_url(sample_project.id, task.id, f"/{comment_id}"))
    assert r.status_code == 204

    listing = client.get(_url(sample_project.id, task.id))
    assert listing.json() == []


# --- 6. Create comment missing required body field ---


def test_create_comment_missing_body(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    r = client.post(
        _url(sample_project.id, task.id),
        json={"author": "Eve"},
    )
    assert r.status_code == 422


# --- 7. Update nonexistent comment ---


def test_update_nonexistent_comment(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    r = client.patch(
        _url(sample_project.id, task.id, "/nonexistent-id"),
        json={"body": "Nope"},
    )
    assert r.status_code == 404
