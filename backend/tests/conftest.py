import os

# Disable auth middleware for tests
os.environ["AUTH_PASSWORD"] = ""

import hashlib
import hmac
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db, get_dialect
from app.main import app
from app.services import graph
from app.services.graph_registry import seed_builtin_types
from app.services.pin_utils import hash_pin
from tests.factories import make_project

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "sqlite:///:memory:")
_dialect = get_dialect(TEST_DATABASE_URL)

_engine_kwargs: dict = {}
if _dialect == "sqlite":
    _engine_kwargs = {
        "connect_args": {"check_same_thread": False},
        "poolclass": StaticPool,
    }
else:
    _engine_kwargs = {"pool_pre_ping": True}

_test_engine = create_engine(TEST_DATABASE_URL, **_engine_kwargs)


@pytest.fixture()
def db():
    Base.metadata.create_all(bind=_test_engine)
    TestSession = sessionmaker(bind=_test_engine)
    session = TestSession()
    seed_builtin_types(session)  # built-in node/edge type vocabulary (ADR-0033)
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=_test_engine)


@pytest.fixture()
def client(db):
    def override():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def post_callback(client):
    """POST a CI callback the way a real provider does — signed (ADR-0060).

    The signature covers the exact bytes on the wire, so the body is serialised here
    rather than handed to httpx's ``json=``: signing one encoding and sending another is
    the mistake this helper exists to stop every caller from making independently.
    """

    def _post(task, payload, *, secret=None, query="", headers=None, sign=True):
        body = json.dumps(payload).encode()
        sent = dict(headers or {})
        if sign:
            key = task.webhook_secret if secret is None else secret
            digest = hmac.new(key.encode(), body, hashlib.sha256).hexdigest()
            sent.setdefault("X-Hub-Signature-256", f"sha256={digest}")
        return client.post(
            f"/webhook/callback/{task.callback_token}{query}",
            content=body,
            headers={"Content-Type": "application/json", **sent},
        )

    return _post


@pytest.fixture()
def sample_identity(db):
    identity = graph.create_identity(db, name="Test User", color="#5e6ad2")
    identity = graph.update_identity(db, identity.id, share_token="test-share-token-123")
    db.commit()
    return identity


@pytest.fixture()
def sample_project(db, sample_identity):
    project = make_project(db, name="Test Project")
    graph.link_membership(db, sample_identity.id, project.id)
    db.commit()
    return project


@pytest.fixture()
def pinned_identity(db):
    identity = graph.create_identity(db, name="Pinned User", color="#818cf8")
    identity = graph.update_identity(
        db,
        identity.id,
        share_token="pinned-token-456",
        share_pin_hash=hash_pin("1234"),
    )
    db.commit()
    return identity
