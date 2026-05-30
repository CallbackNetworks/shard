from datetime import UTC, datetime, timedelta

from app.models import Integration, WebhookDelivery


def _make_integration(db, **overrides):
    defaults = dict(
        name="Test Hook",
        type="webhook",
        url="https://example.com/hook",
        events=["task.done"],
        active=True,
    )
    defaults.update(overrides)
    integ = Integration(**defaults)
    db.add(integ)
    db.flush()
    return integ


def _make_delivery(db, integration_id, **overrides):
    defaults = dict(
        integration_id=integration_id,
        event="task.done",
        payload={"test": True},
        request_url="https://example.com/hook",
        request_headers={"Content-Type": "application/json"},
        attempt=1,
        status="success",
        status_code=200,
    )
    defaults.update(overrides)
    delivery = WebhookDelivery(**defaults)
    db.add(delivery)
    db.flush()
    return delivery


# --- 1. List deliveries empty ---


def test_list_deliveries_empty(client):
    r = client.get("/deliveries")
    assert r.status_code == 200
    assert r.json() == []


# --- 2. List deliveries with data ---


def test_list_deliveries_with_data(client, db):
    integ = _make_integration(db)
    _make_delivery(db, integ.id)
    db.commit()

    r = client.get("/deliveries")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["integration_id"] == integ.id
    assert data[0]["event"] == "task.done"
    assert data[0]["status"] == "success"
    assert data[0]["status_code"] == 200


# --- 3. Get single delivery ---


def test_get_delivery(client, db):
    integ = _make_integration(db)
    delivery = _make_delivery(db, integ.id)
    db.commit()

    r = client.get(f"/deliveries/{delivery.id}")
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == delivery.id
    assert data["event"] == "task.done"
    assert data["payload"] == {"test": True}


# --- 4. Get delivery not found ---


def test_get_delivery_not_found(client):
    r = client.get("/deliveries/nonexistent-id")
    assert r.status_code == 404


# --- 5. Filter deliveries by status ---


def test_list_deliveries_filter_status(client, db):
    integ = _make_integration(db)
    _make_delivery(db, integ.id, status="success", status_code=200)
    _make_delivery(db, integ.id, status="failed", status_code=500)
    _make_delivery(db, integ.id, status="failed", status_code=502)
    db.commit()

    r = client.get("/deliveries", params={"status": "failed"})
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 2
    assert all(d["status"] == "failed" for d in data)


# --- 6. List deliveries for specific integration ---


def test_list_deliveries_for_integration(client, db):
    integ1 = _make_integration(db, name="Hook A")
    integ2 = _make_integration(db, name="Hook B")
    _make_delivery(db, integ1.id)
    _make_delivery(db, integ2.id)
    db.commit()

    r = client.get(f"/integrations/{integ1.id}/deliveries")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["integration_id"] == integ1.id


# --- 7. Integration health stats ---


def test_integration_health(client, db):
    integ = _make_integration(db)
    _make_delivery(db, integ.id, status="success", status_code=200,
                   delivered_at=datetime.now(UTC))
    _make_delivery(db, integ.id, status="failed", status_code=500)
    db.commit()

    r = client.get(f"/integrations/{integ.id}/health")
    assert r.status_code == 200
    data = r.json()
    assert data["integration_id"] == integ.id
    assert data["total_deliveries"] == 2
    assert data["successes"] == 1
    assert data["failures"] == 1
    assert data["period_days"] == 7
    assert "success_rate" in data


# --- 8. Integration not found ---


def test_integration_not_found(client):
    r = client.get("/integrations/nonexistent-id/deliveries")
    assert r.status_code == 404


# --- 9. Purge deliveries ---


def test_purge_deliveries(client, db):
    integ = _make_integration(db)
    # Create a delivery with created_at far in the past so it passes the cutoff
    old_delivery = _make_delivery(db, integ.id)
    old_delivery.created_at = datetime.now(UTC) - timedelta(days=60)
    db.commit()

    r = client.delete("/deliveries", params={"older_than_days": 30})
    assert r.status_code == 204

    # Verify it was purged
    remaining = client.get("/deliveries")
    assert remaining.json() == []


# --- 10. Pagination with limit and offset ---


def test_list_deliveries_pagination(client, db):
    integ = _make_integration(db)
    for i in range(5):
        _make_delivery(db, integ.id, event=f"task.event_{i}")
    db.commit()

    # First page: 2 items
    r = client.get("/deliveries", params={"limit": 2, "offset": 0})
    assert r.status_code == 200
    page1 = r.json()
    assert len(page1) == 2

    # Second page: 2 items
    r = client.get("/deliveries", params={"limit": 2, "offset": 2})
    assert r.status_code == 200
    page2 = r.json()
    assert len(page2) == 2

    # Third page: 1 item
    r = client.get("/deliveries", params={"limit": 2, "offset": 4})
    assert r.status_code == 200
    page3 = r.json()
    assert len(page3) == 1

    # No overlap between pages
    ids_1 = {d["id"] for d in page1}
    ids_2 = {d["id"] for d in page2}
    ids_3 = {d["id"] for d in page3}
    assert ids_1.isdisjoint(ids_2)
    assert ids_1.isdisjoint(ids_3)
    assert ids_2.isdisjoint(ids_3)
