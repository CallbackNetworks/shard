import os

# Disable auth middleware for tests
os.environ["AUTH_PASSWORD"] = ""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Identity, Project, ProjectIdentity
from app.services.pin_utils import hash_pin

_test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@pytest.fixture()
def db():
    Base.metadata.create_all(bind=_test_engine)
    TestSession = sessionmaker(bind=_test_engine)
    session = TestSession()
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
    identity = Identity(name="Test User", color="#5e6ad2", share_token="test-share-token-123")
    db.add(identity)
    db.commit()
    db.refresh(identity)
    return identity


@pytest.fixture()
def sample_project(db, sample_identity):
    project = Project(name="Test Project")
    db.add(project)
    db.flush()
    link = ProjectIdentity(project_id=project.id, identity_id=sample_identity.id)
    db.add(link)
    db.commit()
    db.refresh(project)
    return project


@pytest.fixture()
def pinned_identity(db):
    identity = Identity(
        name="Pinned User",
        color="#818cf8",
        share_token="pinned-token-456",
        share_pin_hash=hash_pin("1234"),
    )
    db.add(identity)
    db.commit()
    db.refresh(identity)
    return identity
