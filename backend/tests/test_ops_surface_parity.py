"""The operational surface answers the same through both doors (ADR-0091).

Settings, backups and the calendar feed token were internal-only, which in production means
behind ``AUTH_PASSWORD``, which means a person in a browser (ADR-0085). Each now has a v1
door, and the assertions that matter are sent through *both* against the same database:
"both doors return 200" is exactly what a drifted duplicate also does (ADR-0087), so the
refusals are compared including their text, and the state written through one door is read
back through the other.

The clamp is its own test. ``backup_hour: 99`` used to answer ``200 {"backup_hour": 23}`` —
the settings equivalent of the ``201``-and-did-nothing ADR-0078 found, and the one defect in
this pass that was live rather than merely unreachable.
"""

import hashlib

import pytest

from app.models import ApiKey
from app.services import backup as backup_service


def _key(db, name, scopes):
    raw = f"tdp_test_{name}"
    db.add(
        ApiKey(
            name=name,
            key_hash=hashlib.sha256(raw.encode()).hexdigest(),
            key_last4=raw[-4:],
            scopes=scopes,
            active=True,
        )
    )
    db.commit()
    return raw


@pytest.fixture()
def admin_key(db):
    return _key(db, "ops_admin", ["read", "write", "admin"])


@pytest.fixture()
def read_key(db):
    return _key(db, "ops_read", ["read"])


def _hdr(key):
    return {"X-API-Key": key}


@pytest.fixture()
def backup_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path))
    return tmp_path


class TestSystemSettings:
    def test_both_doors_report_the_same_settings(self, client, admin_key):
        internal = client.get("/api/settings").json()
        external = client.get("/api/v1/settings", headers=_hdr(admin_key)).json()
        assert internal == external

    def test_a_write_through_one_door_is_visible_through_the_other(self, client, admin_key):
        client.put("/api/v1/settings/system", json={"summary_hour": 6}, headers=_hdr(admin_key))
        assert client.get("/api/settings").json()["summary_hour"] == 6

        client.put("/api/settings/system", json={"summary_hour": 9})
        assert client.get("/api/v1/settings", headers=_hdr(admin_key)).json()["summary_hour"] == 9

    def test_out_of_range_is_refused_identically_not_clamped(self, client, admin_key):
        before = client.get("/api/settings").json()["backup_hour"]

        internal = client.put("/api/settings/system", json={"backup_hour": 99})
        external = client.put("/api/v1/settings/system", json={"backup_hour": 99}, headers=_hdr(admin_key))

        assert internal.status_code == external.status_code == 422
        assert internal.json()["detail"] == external.json()["detail"]
        assert "between 0 and 23" in internal.json()["detail"]
        # The whole point: nothing was stored under a value the caller did not ask for.
        assert client.get("/api/settings").json()["backup_hour"] == before

    def test_an_unknown_setting_is_refused_at_both_doors(self, client, admin_key):
        internal = client.put("/api/settings/system", json={"backup_hours": 3})
        external = client.put("/api/v1/settings/system", json={"backup_hours": 3}, headers=_hdr(admin_key))
        assert internal.status_code == external.status_code == 422

    def test_bounds_describe_what_the_write_path_enforces(self, client, admin_key):
        bounds = client.get("/api/v1/settings/bounds", headers=_hdr(admin_key)).json()
        assert bounds["backup_hour"] == {"min": 0, "max": 23}
        # Every writable setting is described, or composing a payload is guesswork again.
        settings = client.get("/api/v1/settings", headers=_hdr(admin_key)).json()
        assert set(bounds) <= set(settings)

    def test_settings_carry_no_credential(self, client, admin_key):
        body = client.get("/api/v1/settings", headers=_hdr(admin_key)).json()
        assert "smtp_configured" in body
        assert "llm_api_key_configured" in body
        assert isinstance(body["llm_api_key_configured"], bool)
        # A "*_configured" boolean is the ADR-0063 presence flag, not the credential
        # itself (same shape as smtp_configured) — everything else must stay clean.
        suspect = {
            k: v
            for k, v in body.items()
            if not k.endswith("_configured") and ("password" in k or "key" in k or "secret" in k)
        }
        assert not suspect

    def test_reading_is_read_scope_and_writing_is_admin(self, client, read_key):
        assert client.get("/api/v1/settings", headers=_hdr(read_key)).status_code == 200
        assert (
            client.put("/api/v1/settings/system", json={"summary_hour": 5}, headers=_hdr(read_key)).status_code == 403
        )


class TestLLMSettings:
    def test_default_is_stub_and_unconfigured(self, client, admin_key, monkeypatch):
        monkeypatch.delenv("LLM_PROVIDER", raising=False)
        monkeypatch.delenv("LLM_API_KEY", raising=False)
        body = client.get("/api/v1/settings", headers=_hdr(admin_key)).json()
        assert body["llm_provider"] == "stub"
        assert body["llm_api_key_configured"] is False

    def test_a_write_through_v1_is_visible_through_the_internal_door(self, client, admin_key):
        resp = client.put(
            "/api/v1/settings/llm",
            json={"provider": "claude", "model": "claude-sonnet-4-6", "api_key": "sk-test"},
            headers=_hdr(admin_key),
        )
        assert resp.status_code == 200
        assert resp.json()["llm_provider"] == "claude"
        assert resp.json()["llm_api_key_configured"] is True
        # And never the key itself, from either door.
        assert "sk-test" not in resp.text

        internal = client.get("/api/settings").json()
        assert internal["llm_provider"] == "claude"
        assert internal["llm_model"] == "claude-sonnet-4-6"
        assert internal["llm_api_key_configured"] is True

    def test_a_write_through_the_internal_door_is_visible_through_v1(self, client, admin_key):
        client.put("/api/settings/llm", json={"provider": "openai", "api_key": "sk-internal"})
        external = client.get("/api/v1/settings", headers=_hdr(admin_key)).json()
        assert external["llm_provider"] == "openai"
        assert external["llm_api_key_configured"] is True

    def test_omitted_api_key_leaves_it_unchanged(self, client, admin_key):
        client.put("/api/v1/settings/llm", json={"provider": "claude", "api_key": "sk-keep"}, headers=_hdr(admin_key))
        resp = client.put("/api/v1/settings/llm", json={"model": "claude-opus-5"}, headers=_hdr(admin_key))
        assert resp.json()["llm_api_key_configured"] is True
        assert resp.json()["llm_model"] == "claude-opus-5"

    def test_empty_string_clears_back_to_env_default(self, client, admin_key, monkeypatch):
        monkeypatch.setenv("LLM_PROVIDER", "openai")
        client.put("/api/v1/settings/llm", json={"provider": "claude"}, headers=_hdr(admin_key))
        resp = client.put("/api/v1/settings/llm", json={"provider": ""}, headers=_hdr(admin_key))
        assert resp.json()["llm_provider"] == "openai"

    def test_an_unknown_provider_is_refused_identically(self, client, admin_key):
        internal = client.put("/api/settings/llm", json={"provider": "bogus"})
        external = client.put("/api/v1/settings/llm", json={"provider": "bogus"}, headers=_hdr(admin_key))
        assert internal.status_code == external.status_code == 422
        assert internal.json()["detail"] == external.json()["detail"]

    def test_reading_is_read_scope_and_writing_is_admin(self, client, read_key):
        assert client.get("/api/v1/settings", headers=_hdr(read_key)).status_code == 200
        assert (
            client.put("/api/v1/settings/llm", json={"provider": "claude"}, headers=_hdr(read_key)).status_code == 403
        )

    def test_base_url_round_trips_through_both_doors_and_is_not_redacted(self, client, admin_key):
        resp = client.put(
            "/api/v1/settings/llm",
            json={"provider": "openai", "base_url": "https://gateway.example/v1"},
            headers=_hdr(admin_key),
        )
        assert resp.json()["llm_base_url"] == "https://gateway.example/v1"
        internal = client.get("/api/settings").json()
        assert internal["llm_base_url"] == "https://gateway.example/v1"

    def test_writing_a_model_returns_a_best_effort_check_that_never_blocks_the_save(self, client, admin_key):
        """No anthropic/openai package is installed in this image by default (ADR-0096),
        so this degrades to unchecked — and the write still succeeds (ADR-0097)."""
        resp = client.put(
            "/api/v1/settings/llm",
            json={"provider": "claude", "model": "claude-sonnet-4-6", "api_key": "sk-x"},
            headers=_hdr(admin_key),
        )
        assert resp.status_code == 200
        assert resp.json()["llm_model"] == "claude-sonnet-4-6"
        assert resp.json()["model_check"]["checked"] is False
        assert resp.json()["model_check"]["ok"] is None

    def test_no_model_check_when_model_is_not_part_of_the_write(self, client, admin_key):
        resp = client.put("/api/v1/settings/llm", json={"provider": "openai"}, headers=_hdr(admin_key))
        assert "model_check" not in resp.json()


class TestIcalToken:
    def test_the_token_is_the_same_one_through_both_doors(self, client, admin_key):
        internal = client.get("/api/settings/ical-token").json()
        external = client.get("/api/v1/settings/ical-token", headers=_hdr(admin_key)).json()
        assert internal["token"] == external["token"]
        assert external["path"] == f"/ical/all/{external['token']}.ics"

    def test_rotation_through_v1_invalidates_the_old_feed(self, client, admin_key):
        old = client.get("/api/settings/ical-token").json()["token"]
        new = client.post("/api/v1/settings/ical-token/rotate", headers=_hdr(admin_key)).json()["token"]
        assert new != old
        assert client.get(f"/ical/all/{old}.ics").status_code == 404
        assert client.get(f"/ical/all/{new}.ics").status_code == 200

    def test_a_read_key_cannot_have_the_feed_token(self, client, read_key):
        assert client.get("/api/v1/settings/ical-token", headers=_hdr(read_key)).status_code == 403


class TestBackups:
    def test_status_matches_through_both_doors(self, client, admin_key, backup_dir):
        internal = client.get("/api/backup/status").json()
        external = client.get("/api/v1/backup/status", headers=_hdr(admin_key)).json()
        assert internal == external

    def test_a_backup_taken_through_v1_is_listed_by_the_internal_door(self, client, admin_key, backup_dir, db):
        created = client.post("/api/v1/backup/run", headers=_hdr(admin_key))
        assert created.status_code == 200
        filename = created.json()["filename"]
        assert (backup_dir / filename).is_file()

        listed = client.get("/api/backup/status").json()["backups"]
        assert filename in [b["filename"] for b in listed]

    def test_export_is_a_zip_and_needs_admin(self, client, admin_key, read_key, db, sample_project):
        assert client.get("/api/v1/backup/export", headers=_hdr(read_key)).status_code == 403
        resp = client.get("/api/v1/backup/export", headers=_hdr(admin_key))
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/zip"
        assert resp.content[:2] == b"PK"

    def test_status_is_readable_with_a_read_key_but_run_is_not(self, client, read_key, backup_dir):
        assert client.get("/api/v1/backup/status", headers=_hdr(read_key)).status_code == 200
        assert client.post("/api/v1/backup/run", headers=_hdr(read_key)).status_code == 403

    def test_restore_without_confirmation_is_refused_identically(self, client, admin_key, backup_dir):
        name = client.post("/api/v1/backup/run", headers=_hdr(admin_key)).json()["filename"]

        internal = client.post(f"/api/backup/restore/{name}", data={"confirm": "yes"})
        external = client.post(f"/api/v1/backup/restore/{name}?confirm=yes", headers=_hdr(admin_key))

        assert internal.status_code == external.status_code == 400
        assert internal.json()["detail"] == external.json()["detail"]

    def test_a_filename_outside_the_backup_directory_is_refused_identically(self, client, admin_key, backup_dir):
        internal = client.get("/api/backup/download/../../etc/passwd")
        external = client.get("/api/v1/backup/download/../../etc/passwd", headers=_hdr(admin_key))
        assert internal.status_code == external.status_code
        assert internal.status_code in (400, 404)

    def test_a_missing_archive_is_a_404_at_both_doors(self, client, admin_key, backup_dir):
        name = "shard-backup-20200101-000000.zip"
        internal = client.get(f"/api/backup/download/{name}")
        external = client.get(f"/api/v1/backup/download/{name}", headers=_hdr(admin_key))
        assert internal.status_code == external.status_code == 404
        assert internal.json()["detail"] == external.json()["detail"]

    def test_a_round_trip_through_v1_restores_the_archive(self, client, admin_key, backup_dir, db, sample_project):
        name = client.post("/api/v1/backup/run", headers=_hdr(admin_key)).json()["filename"]
        result = client.post(f"/api/v1/backup/restore/{name}?confirm=replace", headers=_hdr(admin_key))
        assert result.status_code == 200
        assert result.json()["table_counts"]

    def test_a_malformed_archive_is_422_and_leaves_the_data_alone(self, client, admin_key, db, sample_project):
        import base64

        payload = {"archive_base64": base64.b64encode(b"not a zip").decode(), "confirm": "replace"}
        resp = client.post("/api/v1/backup/restore", json=payload, headers=_hdr(admin_key))
        assert resp.status_code == 422
        assert client.get(f"/api/v1/projects/{sample_project.id}", headers=_hdr(admin_key)).status_code == 200

    def test_base64_that_is_not_base64_is_a_400(self, client, admin_key):
        resp = client.post(
            "/api/v1/backup/restore",
            json={"archive_base64": "!!!not base64!!!", "confirm": "replace"},
            headers=_hdr(admin_key),
        )
        assert resp.status_code == 400


def test_backup_service_still_has_only_one_filename_rule(backup_dir):
    """The pattern lives in ``backup_admin`` and nowhere else — a second door must not
    bring a second regex with it."""
    from app.services import backup_admin

    (backup_dir / "shard-backup-20260101-000000.zip").write_bytes(b"x")
    assert backup_admin.archive_path("shard-backup-20260101-000000.zip").is_file()
    assert backup_service.get_backup_dir() == backup_dir
