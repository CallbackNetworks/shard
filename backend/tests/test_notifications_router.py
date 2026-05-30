from app.models import Notification


def test_list_empty(client):
    r = client.get("/notifications")
    assert r.status_code == 200
    assert r.json() == []


def test_create_and_list(client, db):
    n = Notification(type="task.done", message="Task completed", read=False)
    db.add(n)
    db.commit()
    db.refresh(n)

    r = client.get("/notifications")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["id"] == n.id
    assert data[0]["type"] == "task.done"
    assert data[0]["message"] == "Task completed"
    assert data[0]["read"] is False


def test_unread_count(client, db):
    db.add(Notification(type="task.done", message="First", read=False))
    db.add(Notification(type="task.done", message="Second", read=False))
    db.commit()

    r = client.get("/notifications/unread-count")
    assert r.status_code == 200
    assert r.json() == {"count": 2}


def test_mark_read(client, db):
    n = Notification(type="task.done", message="Mark me", read=False)
    db.add(n)
    db.commit()
    db.refresh(n)

    r = client.patch(f"/notifications/{n.id}/read")
    assert r.status_code == 200
    assert r.json()["read"] is True

    r = client.get("/notifications/unread-count")
    assert r.json()["count"] == 0


def test_mark_all_read(client, db):
    for i in range(3):
        db.add(Notification(type="task.done", message=f"Notif {i}", read=False))
    db.commit()

    r = client.post("/notifications/mark-all-read")
    assert r.status_code == 204

    r = client.get("/notifications/unread-count")
    assert r.json()["count"] == 0


def test_filter_unread_only(client, db):
    db.add(Notification(type="task.done", message="Already read", read=True))
    db.add(Notification(type="task.done", message="Still unread", read=False))
    db.commit()

    r = client.get("/notifications", params={"unread_only": True})
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["message"] == "Still unread"


def test_delete_notification(client, db):
    n = Notification(type="task.done", message="Delete me", read=False)
    db.add(n)
    db.commit()
    db.refresh(n)

    r = client.delete(f"/notifications/{n.id}")
    assert r.status_code == 204

    r = client.get("/notifications")
    assert r.status_code == 200
    assert r.json() == []
