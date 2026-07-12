"""Config hardening: CORS origins from env, and no fixed share-PIN secret."""


def test_cors_origins_default(monkeypatch):
    from app.main import _cors_origins

    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    origins = _cors_origins()
    assert "http://localhost:5173" in origins
    assert "http://localhost:4173" in origins


def test_cors_origins_from_env(monkeypatch):
    from app.main import _cors_origins

    monkeypatch.setenv("CORS_ORIGINS", "https://a.example.com, https://b.example.com ")
    assert _cors_origins() == ["https://a.example.com", "https://b.example.com"]


def test_pin_secret_uses_env_when_set(monkeypatch):
    from app.routers.share import _resolve_pin_secret

    monkeypatch.setenv("SECRET_KEY", "my-real-secret")
    assert _resolve_pin_secret() == "my-real-secret"


def test_pin_secret_random_when_unset(monkeypatch):
    from app.routers.share import _resolve_pin_secret

    monkeypatch.delenv("SECRET_KEY", raising=False)
    a = _resolve_pin_secret()
    b = _resolve_pin_secret()
    # No fixed constant: unset yields a random secret each call, never the old default.
    assert a != "share-pin-default-secret"
    assert a != b
    assert len(a) >= 32
