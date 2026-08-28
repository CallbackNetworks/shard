"""A download names its file after something a person wrote (ADR-0115).

`GET /decisions/{id}/export` answered 500 for every record on the user's own instance
and 200 for exactly one — the only decision with an ASCII title. The cause was not in
the export: HTTP header values are latin-1, so `Content-Disposition: attachment;
filename="決策"` raises while Starlette is encoding the response, after the body is
already built. Nothing about it reads as a filename bug.

Starlette's own `FileResponse` has always handled this (RFC 6266 `filename*`), which is
why the SPA's attachment download worked while its `/api/v1` twin — a hand-built
`Response` carrying a hand-built header — did not: two doors onto one download,
disagreeing (ADR-0085).
"""

import hashlib
import io

import pytest

from app.services import graph
from app.services.downloads import attachment_headers


@pytest.fixture()
def read_key(db):
    from app.models import ApiKey

    raw = "tdp_test_download_read"
    db.add(
        ApiKey(
            name="download_read",
            key_hash=hashlib.sha256(raw.encode()).hexdigest(),
            key_last4=raw[-4:],
            scopes=["read"],
            active=True,
        )
    )
    db.commit()
    return raw


CJK_NAME = "決策：儲存層改用 PostgreSQL"


class TestTheHeaderBuilder:
    def test_an_ascii_name_stays_a_plain_quoted_filename(self):
        assert attachment_headers("tasks.csv") == {"Content-Disposition": 'attachment; filename="tasks.csv"'}

    def test_a_non_ascii_name_travels_in_the_extended_form(self):
        value = attachment_headers("報告.pdf")["Content-Disposition"]
        assert value.startswith("attachment; filename*=utf-8''")
        assert "報告" not in value  # percent-encoded, so the header is latin-1 safe

    def test_every_header_it_builds_can_actually_be_sent(self):
        # The defect was an encode error at response time, so this is the assertion
        # that would have failed: latin-1 is what the ASGI layer encodes headers as.
        for name in ("tasks.csv", CJK_NAME, "a b.md", 'quote".md', "emoji-🎉.zip"):
            attachment_headers(name)["Content-Disposition"].encode("latin-1")


def _decision(db, project_id, name):
    label = graph.create_decision(db, project_id, name=name, color="#5e6ad2")
    db.commit()
    return label


class TestExportingARecordWrittenInChinese:
    def test_the_internal_door_exports_it(self, client, db, sample_project):
        decision = _decision(db, sample_project.id, CJK_NAME)
        r = client.get(f"/api/decisions/{decision.id}/export")
        assert r.status_code == 200
        assert CJK_NAME in r.text
        r.headers["content-disposition"].encode("latin-1")

    def test_the_v1_door_answers_identically(self, client, db, sample_project, read_key):
        decision = _decision(db, sample_project.id, CJK_NAME)
        internal = client.get(f"/api/decisions/{decision.id}/export")
        external = client.get(f"/api/v1/decisions/{decision.id}/export", headers={"X-API-Key": read_key})
        assert external.status_code == internal.status_code == 200
        assert external.text == internal.text


class TestAnAttachmentKeepsTheNameItWasUploadedUnder:
    def test_the_v1_download_does_not_break_on_a_non_ascii_filename(self, client, db, sample_project, read_key):
        task = graph.create_node(db, graph.NODE_TASK, title="write it up")
        graph.add_edge(db, sample_project.id, task.id, graph.REL_CONTAINS)
        db.commit()
        up = client.post(
            f"/api/projects/{sample_project.id}/tasks/{task.id}/attachments",
            files={"file": ("報告.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
        )
        assert up.status_code in (200, 201), up.text
        att_id = up.json()["id"]

        r = client.get(
            f"/api/v1/projects/{sample_project.id}/tasks/{task.id}/attachments/{att_id}/download",
            headers={"X-API-Key": read_key},
        )
        assert r.status_code == 200
        assert r.content == b"%PDF-1.4 fake"
        r.headers["content-disposition"].encode("latin-1")
