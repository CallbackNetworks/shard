"""Closing the read/write asymmetries and the last browser-only reads (ADR-0086).

A missing feature and a half-open door are not the same defect. Three of these were the
second kind — the API *described* a capability it did not offer:

* every ``TaskOut`` carried ``recurrence`` and nothing could set it;
* a task could be put into a cycle (membership is an edge) and no endpoint said what a
  cycle contained;
* an agent's output is mostly files and there was nowhere to put one.

The rest is reach: the planning half of analytics, templates, the export/import round trip,
and the relation registry, which ADR-0079 left read-only on ``/api/v1`` for a reason that
does not survive inspection (see ``TestRelationsCanBeDeclaredThroughTheApi``).
"""

import base64
import hashlib

import pytest

from app.models import ApiKey, TaskTemplate
from tests.factories import make_task


def _key(db, name, scopes, container_id=None):
    raw = f"tdp_test_{name}"
    db.add(
        ApiKey(
            name=name,
            key_hash=hashlib.sha256(raw.encode()).hexdigest(),
            key_last4=raw[-4:],
            scopes=scopes,
            container_id=container_id,
            active=True,
        )
    )
    db.commit()
    return raw


@pytest.fixture()
def admin_key(db):
    return _key(db, "gap_admin", ["read", "write", "admin"])


@pytest.fixture()
def write_key(db):
    return _key(db, "gap_write", ["read", "write"])


@pytest.fixture()
def read_key(db):
    return _key(db, "gap_read", ["read"])


def _hdr(key):
    return {"X-API-Key": key}


@pytest.fixture()
def task(db, sample_project):
    t = make_task(db, project_id=sample_project.id, title="Subject", status="todo")
    db.commit()
    return t


class TestRecurrenceCanBeWrittenByWhoeverCanReadIt:
    """`enrich_task` has always put `recurrence` on every v1 task payload."""

    def test_the_field_an_agent_was_shown_is_now_settable(self, client, write_key, sample_project, task):
        before = client.get(f"/api/v1/projects/{sample_project.id}/tasks/{task.id}", headers=_hdr(write_key)).json()
        assert "recurrence" in before and before["recurrence"] is None

        created = client.post(
            f"/api/v1/projects/{sample_project.id}/tasks/{task.id}/recurrence",
            headers=_hdr(write_key),
            json={"frequency": "weekly", "interval_value": 1, "day_of_week": 1, "next_run_at": "2026-09-01T09:00:00Z"},
        )
        assert created.status_code == 201

        after = client.get(f"/api/v1/projects/{sample_project.id}/tasks/{task.id}", headers=_hdr(write_key)).json()
        assert after["recurrence"]["frequency"] == "weekly"

    def test_a_second_rule_is_refused_identically_at_both_doors(self, client, write_key, sample_project, task):
        body = {"frequency": "daily", "interval_value": 1, "next_run_at": "2026-09-01T09:00:00Z"}
        client.post(f"/api/projects/{sample_project.id}/tasks/{task.id}/recurrence", json=body)

        internal = client.post(f"/api/projects/{sample_project.id}/tasks/{task.id}/recurrence", json=body)
        external = client.post(
            f"/api/v1/projects/{sample_project.id}/tasks/{task.id}/recurrence", headers=_hdr(write_key), json=body
        )

        assert internal.status_code == external.status_code == 409
        assert internal.json()["detail"] == external.json()["detail"]

    def test_clearing_it_puts_the_field_back_to_null(self, client, write_key, sample_project, task):
        client.post(
            f"/api/v1/projects/{sample_project.id}/tasks/{task.id}/recurrence",
            headers=_hdr(write_key),
            json={"frequency": "daily", "interval_value": 1, "next_run_at": "2026-09-01T09:00:00Z"},
        )
        client.delete(f"/api/v1/projects/{sample_project.id}/tasks/{task.id}/recurrence", headers=_hdr(write_key))

        read = client.get(f"/api/v1/projects/{sample_project.id}/tasks/{task.id}", headers=_hdr(write_key)).json()
        assert read["recurrence"] is None

    def test_a_read_key_cannot_set_one(self, client, read_key, sample_project, task):
        resp = client.post(
            f"/api/v1/projects/{sample_project.id}/tasks/{task.id}/recurrence",
            headers=_hdr(read_key),
            json={"frequency": "daily", "interval_value": 1, "next_run_at": "2026-09-01T09:00:00Z"},
        )
        assert resp.status_code == 403


class TestAnAgentCanAttachItsOutput:
    def test_upload_round_trips_through_base64(self, client, write_key, sample_project, task):
        payload = b"build log line 1\nbuild log line 2\n"
        created = client.post(
            f"/api/v1/projects/{sample_project.id}/tasks/{task.id}/attachments",
            headers=_hdr(write_key),
            json={
                "filename": "build.log",
                "content_base64": base64.b64encode(payload).decode(),
                "content_type": "text/plain",
            },
        )
        assert created.status_code == 201
        att_id = created.json()["id"]
        assert created.json()["size"] == len(payload)

        listed = client.get(
            f"/api/v1/projects/{sample_project.id}/tasks/{task.id}/attachments", headers=_hdr(write_key)
        ).json()
        assert [a["filename"] for a in listed] == ["build.log"]

        downloaded = client.get(
            f"/api/v1/projects/{sample_project.id}/tasks/{task.id}/attachments/{att_id}/download",
            headers=_hdr(write_key),
        )
        assert downloaded.content == payload

    def test_the_multipart_door_and_the_json_door_produce_the_same_row(self, client, write_key, sample_project, task):
        payload = b"same bytes"
        client.post(
            f"/api/projects/{sample_project.id}/tasks/{task.id}/attachments",
            files={"file": ("a.txt", payload, "text/plain")},
        )
        client.post(
            f"/api/v1/projects/{sample_project.id}/tasks/{task.id}/attachments",
            headers=_hdr(write_key),
            json={
                "filename": "b.txt",
                "content_base64": base64.b64encode(payload).decode(),
                "content_type": "text/plain",
            },
        )

        rows = client.get(f"/api/projects/{sample_project.id}/tasks/{task.id}/attachments").json()
        assert {r["size"] for r in rows} == {len(payload)}
        assert {r["content_type"] for r in rows} == {"text/plain"}

    def test_bad_base64_is_a_422_not_a_corrupt_file(self, client, write_key, sample_project, task):
        resp = client.post(
            f"/api/v1/projects/{sample_project.id}/tasks/{task.id}/attachments",
            headers=_hdr(write_key),
            json={"filename": "x.bin", "content_base64": "not base64!!"},
        )
        assert resp.status_code == 422

    def test_an_oversize_file_is_refused_at_both_doors(self, client, write_key, sample_project, task):
        from app.services import attachment_admin

        too_big = b"x" * (attachment_admin.MAX_FILE_SIZE + 1)
        multipart = client.post(
            f"/api/projects/{sample_project.id}/tasks/{task.id}/attachments",
            files={"file": ("big.bin", too_big, "application/octet-stream")},
        )
        json_door = client.post(
            f"/api/v1/projects/{sample_project.id}/tasks/{task.id}/attachments",
            headers=_hdr(write_key),
            json={"filename": "big.bin", "content_base64": base64.b64encode(too_big).decode()},
        )

        # One limit, in the service, so a second upload path cannot grow its own.
        assert multipart.status_code == json_door.status_code == 400
        assert multipart.json()["detail"] == json_door.json()["detail"]


class TestACycleCanBeRead:
    """Membership was writable through `/nodes/{id}/edges` from the start; the read was
    what did not exist."""

    def test_a_cycle_lists_the_tasks_put_into_it_through_the_edge_surface(
        self, client, db, write_key, sample_project, task
    ):
        cycle_id = client.post(
            "/api/v1/nodes",
            headers=_hdr(write_key),
            json={"type": "cycle", "title": "Sprint 1", "container_id": sample_project.id},
        ).json()["id"]
        client.post(
            f"/api/v1/nodes/{task.id}/edges",
            headers=_hdr(write_key),
            json={"target_id": cycle_id, "rel_type": "in_cycle"},
        )

        listed = client.get(f"/api/v1/projects/{sample_project.id}/cycles", headers=_hdr(write_key)).json()
        mine = next(c for c in listed if c["id"] == cycle_id)
        assert mine["task_ids"] == [task.id]
        assert mine["total_tasks"] == 1
        assert mine["done_tasks"] == 0

    def test_both_doors_enrich_a_cycle_the_same_way(self, client, write_key, sample_project):
        client.post(
            "/api/v1/nodes",
            headers=_hdr(write_key),
            json={"type": "cycle", "title": "Sprint 2", "container_id": sample_project.id},
        )
        internal = client.get(f"/api/projects/{sample_project.id}/cycles").json()
        external = client.get(f"/api/v1/projects/{sample_project.id}/cycles", headers=_hdr(write_key)).json()
        assert internal == external

    def test_an_unknown_cycle_is_404_at_both(self, client, write_key, sample_project):
        internal = client.get(f"/api/projects/{sample_project.id}/cycles/nope")
        external = client.get(f"/api/v1/projects/{sample_project.id}/cycles/nope", headers=_hdr(write_key))
        assert internal.status_code == external.status_code == 404
        assert internal.json()["detail"] == external.json()["detail"]


class TestNotificationsCanBeCleared:
    """`unread-count` only ever grows for a reader that cannot acknowledge anything, which
    makes the endpoint useless to the caller it was added for."""

    @pytest.fixture()
    def notifications(self, db):
        from app.models import Notification

        rows = [Notification(type="task.due_soon", message=f"n{i}", read=False) for i in range(3)]
        db.add_all(rows)
        db.commit()
        return rows

    def test_mark_all_read_zeroes_the_count(self, client, write_key, notifications):
        assert client.get("/api/v1/notifications/unread-count", headers=_hdr(write_key)).json()["count"] == 3

        assert client.post("/api/v1/notifications/mark-all-read", headers=_hdr(write_key)).status_code == 204

        assert client.get("/api/v1/notifications/unread-count", headers=_hdr(write_key)).json()["count"] == 0

    def test_dismissing_removes_it(self, client, write_key, notifications):
        assert client.delete(f"/api/v1/notifications/{notifications[0].id}", headers=_hdr(write_key)).status_code == 204
        assert len(client.get("/api/v1/notifications", headers=_hdr(write_key)).json()) == 2

    def test_a_read_key_cannot_clear(self, client, read_key, notifications):
        assert client.post("/api/v1/notifications/mark-all-read", headers=_hdr(read_key)).status_code == 403


class TestPlanningAnalytics:
    def test_critical_path_agrees_at_both_doors(self, client, db, read_key, sample_project):
        a = make_task(db, project_id=sample_project.id, title="A")
        b = make_task(db, project_id=sample_project.id, title="B")
        db.commit()
        client.post(f"/api/projects/{sample_project.id}/tasks/{b.id}/dependencies/{a.id}")

        internal = client.get(f"/api/analytics/critical-path/{sample_project.id}").json()
        external = client.get(f"/api/v1/analytics/critical-path/{sample_project.id}", headers=_hdr(read_key)).json()
        assert internal == external

    def test_estimate_suggestion_declines_rather_than_inventing_a_number(self, client, read_key):
        answer = client.get(
            "/api/v1/analytics/estimate-suggestion", headers=_hdr(read_key), params={"raw_estimate": 120}
        ).json()
        assert answer["suggested_estimate"] is None
        assert answer["reason"] == "not_enough_history"

    def test_calibration_agrees_at_both_doors(self, client, read_key):
        internal = client.get("/api/analytics/estimation-calibration").json()
        external = client.get("/api/v1/analytics/estimation-calibration", headers=_hdr(read_key)).json()
        assert internal == external


class TestExportImportRoundTrip:
    def test_what_comes_out_can_go_back_in(self, client, db, write_key, sample_project):
        make_task(db, project_id=sample_project.id, title="One", status="todo", priority="high")
        make_task(db, project_id=sample_project.id, title="Two", status="done", priority="low")
        db.commit()

        rows = client.get(f"/api/v1/projects/{sample_project.id}/tasks/export", headers=_hdr(write_key)).json()
        assert {r["title"] for r in rows} == {"One", "Two"}

        target = client.post(
            "/api/v1/nodes", headers=_hdr(write_key), json={"type": "project", "title": "Copy"}
        ).json()["id"]
        result = client.post(
            f"/api/v1/projects/{target}/tasks/import",
            headers=_hdr(write_key),
            json={"tasks": [{"title": r["title"], "status": r["status"], "priority": r["priority"]} for r in rows]},
        )

        assert result.status_code == 200
        assert result.json()["imported"] == 2
        copied = client.get(f"/api/v1/projects/{target}/tasks/export", headers=_hdr(write_key)).json()
        assert {r["title"] for r in copied} == {"One", "Two"}

    def test_csv_is_offered_too(self, client, db, write_key, sample_project):
        make_task(db, project_id=sample_project.id, title="Csv me")
        db.commit()
        resp = client.get(
            f"/api/v1/projects/{sample_project.id}/tasks/export", headers=_hdr(write_key), params={"format": "csv"}
        )
        assert resp.headers["content-type"].startswith("text/csv")
        assert "Csv me" in resp.text

    def test_subtasks_nest(self, client, write_key, sample_project):
        result = client.post(
            f"/api/v1/projects/{sample_project.id}/tasks/import",
            headers=_hdr(write_key),
            json={"tasks": [{"title": "Parent", "subtasks": [{"title": "Child"}]}]},
        )
        assert result.json()["imported"] == 2


class TestTemplates:
    def test_an_agent_can_create_and_list_a_template(self, client, write_key):
        created = client.post(
            "/api/v1/templates",
            headers=_hdr(write_key),
            json={"name": "Bug triage", "title_template": "Triage: {title}", "priority": "high"},
        )
        assert created.status_code == 201
        assert any(t["name"] == "Bug triage" for t in client.get("/api/v1/templates", headers=_hdr(write_key)).json())

    def test_a_global_template_shows_up_for_a_project(self, client, db, write_key, sample_project):
        db.add(TaskTemplate(name="Global", project_id=None))
        db.commit()
        listed = client.get(
            "/api/v1/templates", headers=_hdr(write_key), params={"project_id": sample_project.id}
        ).json()
        assert any(t["name"] == "Global" for t in listed)

    def test_a_read_key_cannot_create_one(self, client, read_key):
        assert client.post("/api/v1/templates", headers=_hdr(read_key), json={"name": "x"}).status_code == 403


class TestRelationsCanBeDeclaredThroughTheApi:
    """ADR-0079 left edge types read-only on v1, reasoning that a relation without endpoint
    declarations is what ADR-0078 closed. The internal door has always been able to create
    exactly that, so the restriction never prevented the bad state — it only prevented an
    agent from reaching a state the UI reaches in two clicks (ADR-0086)."""

    def test_creating_a_relation_and_using_it(self, client, db, admin_key, sample_project):
        created = client.post(
            "/api/v1/edge-types",
            headers=_hdr(admin_key),
            json={
                "key": "reviews",
                "label": "Reviews",
                "description": "identity reviews a task",
                "allowed_source": {"types": ["identity"], "roles": []},
                "allowed_target": {"types": [], "roles": ["task"]},
            },
        )
        assert created.status_code == 201

        vocab = client.get("/api/v1/edge-types", headers=_hdr(admin_key)).json()["relations"]
        assert any(r["key"] == "reviews" for r in vocab)

    def test_a_typo_in_an_endpoint_rule_is_refused_identically_at_both_doors(self, client, admin_key):
        body = {
            "key": "bogus",
            "label": "Bogus",
            "allowed_source": {"types": [], "roles": ["nonexistent_role"]},
        }
        internal = client.post("/api/graph-types/edges", json=body)
        external = client.post("/api/v1/edge-types", headers=_hdr(admin_key), json=body)

        # A rule carrying a typo constrains nothing and explains nothing (ADR-0056's trap).
        assert internal.status_code == external.status_code == 422
        assert internal.json()["detail"] == external.json()["detail"]

    @pytest.mark.parametrize(
        "method,path,body",
        [
            ("post", "/api/v1/edge-types", {"key": "x", "label": "X"}),
            ("patch", "/api/v1/edge-types/contains", {"label": "Renamed"}),
            ("delete", "/api/v1/edge-types/contains", None),
        ],
    )
    def test_writing_the_registry_needs_admin(self, client, write_key, method, path, body):
        call = getattr(client, method)
        resp = call(path, headers=_hdr(write_key), **({"json": body} if body else {}))
        assert resp.status_code == 403

    def test_a_builtin_relation_is_still_protected_at_both_doors(self, client, admin_key):
        internal = client.delete("/api/graph-types/edges/contains")
        external = client.delete("/api/v1/edge-types/contains", headers=_hdr(admin_key))
        assert internal.status_code == external.status_code
        assert internal.json()["detail"] == external.json()["detail"]


class TestToolsSchemaIsGenerated:
    """It was a hand-written list beside the MCP registry, describing the same operations,
    and it had drifted by a dozen tools. ADR-0077 solved this once; this projects from that
    solution instead of repeating the mistake."""

    @pytest.mark.asyncio
    async def test_it_matches_the_mcp_registry_exactly(self, client, read_key):
        from app.mcp_server.server import mcp

        served = {t["name"] for t in client.get("/api/v1/tools-schema", headers=_hdr(read_key)).json()}
        registered = {t.name for t in await mcp.list_tools()}

        assert served == registered

    def test_every_entry_has_what_a_function_caller_needs(self, client, read_key):
        tools = client.get("/api/v1/tools-schema", headers=_hdr(read_key)).json()
        assert len(tools) > 25
        for tool in tools:
            assert tool["description"]
            assert tool["parameters"]["type"] == "object"


class TestALiteralPathIsNotSwallowedByAParameter:
    """`/projects/{id}/tasks/export` was shadowed by `/projects/{id}/tasks/{task_id}`.

    Routing is first-match, so a parameterised route registered earlier answers the literal
    one with `task_id="export"` — a 404 that looks like a missing feature rather than a
    misordered include. Nothing about the two declarations reveals the conflict; only the
    order they were included in does. Same shape as ADR-0061, one namespace over.
    """

    def test_no_v1_literal_segment_is_shadowed_by_an_earlier_parameter(self):
        import re

        from app.main import app

        spec = app.openapi()["paths"]
        # (method, path) in registration order. Method matters: Starlette treats a path
        # match with the wrong method as a partial match and keeps looking, so
        # `POST /tasks/bulk` under `GET /tasks/{task_id}` is fine — only a same-method
        # shadow is unreachable.
        routes = [
            (method.upper(), path)
            for path, operations in spec.items()
            if path.startswith("/api/v1")
            for method in operations
        ]
        assert len(routes) > 60, "the sweep found suspiciously few v1 routes"

        def shadows(earlier: str, later: str) -> bool:
            a_segments, b_segments = earlier.strip("/").split("/"), later.strip("/").split("/")
            if len(a_segments) != len(b_segments) or earlier == later:
                return False
            return all(
                a == b or (re.fullmatch(r"\{.+\}", a) and not re.fullmatch(r"\{.+\}", b))
                for a, b in zip(a_segments, b_segments, strict=False)
            )

        shadowed = [
            (method, path, earlier_path)
            for index, (method, path) in enumerate(routes)
            for earlier_method, earlier_path in routes[:index]
            if earlier_method == method and shadows(earlier_path, path)
        ]

        assert not shadowed, (
            "These routes can never be reached: an earlier-registered parameterised path "
            "matches them first with the same method. Include the literal route before the "
            f"parameterised one in `external_api/__init__.py`: {shadowed}"
        )
