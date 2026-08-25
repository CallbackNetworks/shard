"""Sharing has one write implementation, for both doors (ADR-0087).

ADR-0070→0073 collapsed sharing onto one panel, one public page, one data endpoint and one
calendar feed. The write surface was collapsed too — for the SPA. When ``/api/v1`` grew a
share facade it was written fresh alongside, minting its own token from its own ``uuid4()``
and repeating each rule.

Nothing had broken, which is the state ADR-0070 warns about: a duplicate that still works
has no failure symptom. ADR-0072 was the bill for the last one — a project-share PIN that
could be *set* and was silently ignored, so the owner got ``{"ok": true}`` and no lock.

These tests are therefore aimed at the *output boundary*: not "does each door return 200"
but "does a share configured through one door behave identically at the public page the
other door's share would be read from".
"""

import hashlib

import pytest

from app.models import ApiKey
from app.services import graph


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
    return _key(db, "share_admin", ["read", "write", "admin"])


@pytest.fixture()
def write_key(db):
    return _key(db, "share_write", ["read", "write"])


@pytest.fixture()
def read_key(db):
    return _key(db, "share_read", ["read"])


def _hdr(key):
    return {"X-API-Key": key}


class TestOneTokenGenerator:
    """The concrete duplication: v1 minted its own uuid instead of calling the helper."""

    def test_a_token_minted_through_v1_opens_the_public_page(self, client, admin_key, sample_project):
        token = client.post(f"/api/v1/nodes/{sample_project.id}/share/rotate-token", headers=_hdr(admin_key)).json()[
            "share_token"
        ]

        # The output boundary: the link a user is handed has to be the link the page reads.
        assert client.get(f"/share/node/{token}").status_code == 200

    def test_rotating_at_either_door_invalidates_the_other_door_s_token(self, client, admin_key, sample_project):
        internal_token = client.post(f"/api/nodes/{sample_project.id}/share/rotate-token").json()["share_token"]

        client.post(f"/api/v1/nodes/{sample_project.id}/share/rotate-token", headers=_hdr(admin_key))

        # One token per node, wherever it was minted — not one per door.
        assert client.get(f"/share/node/{internal_token}").status_code == 404


class TestTheRulesAreOneSet:
    @pytest.mark.parametrize("pin", ["12", "1234567", "abcd", ""])
    def test_a_bad_pin_is_refused_identically_at_both_doors(self, client, write_key, sample_project, pin):
        internal = client.post(f"/api/nodes/{sample_project.id}/share/set-pin", json={"pin": pin})
        external = client.post(
            f"/api/v1/nodes/{sample_project.id}/share/set-pin", headers=_hdr(write_key), json={"pin": pin}
        )

        assert internal.status_code == external.status_code == 400
        assert internal.json()["detail"] == external.json()["detail"]

    def test_a_type_that_cannot_be_shared_is_refused_identically(self, client, db, admin_key):
        label = graph.create_node(db, graph.NODE_LABEL, title="not shareable")
        db.commit()

        internal = client.post(f"/api/nodes/{label.id}/share/rotate-token")
        external = client.post(f"/api/v1/nodes/{label.id}/share/rotate-token", headers=_hdr(admin_key))

        assert internal.status_code == external.status_code == 400
        assert internal.json()["detail"] == external.json()["detail"]

    def test_an_unknown_node_is_404_at_both(self, client, admin_key):
        internal = client.post("/api/nodes/nope/share/rotate-token")
        external = client.post("/api/v1/nodes/nope/share/rotate-token", headers=_hdr(admin_key))

        assert internal.status_code == external.status_code == 404
        assert internal.json()["detail"] == external.json()["detail"]


class TestAPinSetThroughEitherDoorActuallyLocks:
    """ADR-0072's defect, checked from both sides: a lock that can be set and is ignored is
    worse than no lock, because the owner is told it worked."""

    @pytest.mark.parametrize("door", ["internal", "v1"])
    def test_the_public_page_demands_the_pin(self, client, write_key, sample_project, door):
        token = client.post(f"/api/nodes/{sample_project.id}/share/rotate-token").json()["share_token"]
        if door == "internal":
            client.post(f"/api/nodes/{sample_project.id}/share/set-pin", json={"pin": "1234"})
        else:
            client.post(
                f"/api/v1/nodes/{sample_project.id}/share/set-pin", headers=_hdr(write_key), json={"pin": "1234"}
            )

        gated = client.get(f"/share/node/{token}").json()
        assert gated["meta"]["requires_pin"] is True

    @pytest.mark.parametrize("door", ["internal", "v1"])
    def test_clearing_it_reopens_the_page(self, client, write_key, sample_project, door):
        token = client.post(f"/api/nodes/{sample_project.id}/share/rotate-token").json()["share_token"]
        client.post(f"/api/nodes/{sample_project.id}/share/set-pin", json={"pin": "1234"})

        if door == "internal":
            client.delete(f"/api/nodes/{sample_project.id}/share/pin")
        else:
            client.delete(f"/api/v1/nodes/{sample_project.id}/share/pin", headers=_hdr(write_key))

        assert client.get(f"/share/node/{token}").json()["meta"]["requires_pin"] is False


class TestExpiryAndGuestNotesAgree:
    def test_an_expiry_set_through_v1_closes_the_page(self, client, write_key, sample_project):
        token = client.post(f"/api/nodes/{sample_project.id}/share/rotate-token").json()["share_token"]

        client.post(
            f"/api/v1/nodes/{sample_project.id}/share/set-expiry",
            headers=_hdr(write_key),
            json={"expires_at": "2020-01-01T00:00:00Z"},
        )

        assert client.get(f"/share/node/{token}").status_code == 410

    def test_guest_notes_read_back_the_same_at_both_doors(self, client, db, write_key, sample_project):
        client.post(
            f"/api/v1/nodes/{sample_project.id}/share/set-guest-notes",
            headers=_hdr(write_key),
            json={"allowed": True},
        )
        db.expire_all()
        assert graph.get_node(db, sample_project.id).data["allow_guest_notes"] is True

        client.post(f"/api/nodes/{sample_project.id}/share/set-guest-notes", json={"allowed": False})
        db.expire_all()
        assert graph.get_node(db, sample_project.id).data["allow_guest_notes"] is False


class TestWhoMayAsk:
    """Where the doors differ on purpose."""

    @pytest.mark.parametrize("scope_key", ["read_key", "write_key"])
    def test_rotating_the_token_needs_admin_rather_than_returning_an_empty_body(
        self, client, sample_project, scope_key, request
    ):
        """Found by collapsing the two doors (ADR-0087). A `write` key used to get
        `200 {}`: the rotation happened, the live link broke, and the middleware had
        removed the one field that said what the new link was."""
        key = request.getfixturevalue(scope_key)
        resp = client.post(f"/api/v1/nodes/{sample_project.id}/share/rotate-token", headers=_hdr(key))

        assert resp.status_code == 403
        assert "share_token" not in resp.json()

    def test_the_other_share_writes_still_only_need_write(self, client, write_key, sample_project):
        # They answer `{"ok": true}` and carry no capability, so nothing is withheld.
        assert (
            client.post(
                f"/api/v1/nodes/{sample_project.id}/share/set-pin", headers=_hdr(write_key), json={"pin": "1234"}
            ).status_code
            == 200
        )

    def test_a_read_key_can_still_see_the_view_count(self, client, read_key, sample_project):
        resp = client.get(f"/api/v1/nodes/{sample_project.id}/share-views", headers=_hdr(read_key))
        assert resp.status_code == 200
        assert resp.json()["view_count"] == 0

    def test_the_view_count_agrees_at_both_doors(self, client, write_key, sample_project):  # noqa: D
        token = client.post(f"/api/nodes/{sample_project.id}/share/rotate-token").json()["share_token"]
        client.get(f"/share/node/{token}")

        internal = client.get(f"/api/nodes/{sample_project.id}/share-views").json()
        external = client.get(f"/api/v1/nodes/{sample_project.id}/share-views", headers=_hdr(write_key)).json()

        assert internal == external
        assert internal["view_count"] >= 1
