import os

# Disable auth middleware for tests
os.environ["AUTH_PASSWORD"] = ""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db, get_dialect
from app.main import app
from app.models import Project
from app.services import graph
from app.services.graph_registry import seed_builtin_types
from app.services.pin_utils import hash_pin

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
def sample_identity(db):
    identity = graph.create_identity(db, name="Test User", color="#5e6ad2")
    identity = graph.update_identity(db, identity.id, share_token="test-share-token-123")
    db.commit()
    return identity


@pytest.fixture()
def sample_project(db, sample_identity):
    project = Project(name="Test Project")
    db.add(project)
    db.flush()
    graph.link_membership(db, sample_identity.id, project.id)
    db.commit()
    db.refresh(project)
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
