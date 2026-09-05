"""One node listing rule, and the three questions it could not answer (ADR-0153).

The internal and external doors each carried a hand-written copy of the same query, and
they had already fallen apart: ADR-0150 taught the internal one ``unfiled`` and
``offset`` and the v1 one stayed where it was, so an agent could not ask the question
the page in front of it asks. These tests are about *agreement* and about the three
gaps, not about any particular node.
"""

import hashlib

import pytest

from app.models import ApiKey, Node
from app.services import graph, node_listing


def _mk(db, **kwargs):
    node = Node(**kwargs)
    db.add(node)
    db.commit()
    return node


@pytest.fixture
def admin_key(db):
    raw = "listing-key"
    key = ApiKey(name="listing", key_hash=hashlib.sha256(raw.encode()).hexdigest(), scopes="admin")
    db.add(key)
    db.commit()
    return raw


class TestSearchAcceptsWhatThePagePrints:
    def test_an_id_prefix_finds_the_node(self, client, db, sample_project):
        """The explorer prints ``type · id`` in the pane beside the search box, and the
        search matched titles only — so pasting back what the page had just shown you
        matched nothing."""
        r = client.get(f"/api/nodes?query={sample_project.id[:12]}")
        assert r.status_code == 200
        assert [n["id"] for n in r.json()] == [sample_project.id]

    def test_a_short_term_is_not_treated_as_an_id(self, client, db, sample_project):
        """A one-letter term must not drag in every node whose uuid happens to start
        with it — the id match is a prefix, and a prefix of one character is not a
        search, it is a sample of the alphabet."""
        first = sample_project.id[0]
        assert len(first) < node_listing.ID_QUERY_MIN
        hits = client.get(f"/api/nodes?query={first}").json()
        assert all(first.lower() in n["title"].lower() for n in hits)

    def test_the_title_still_matches(self, client, sample_project):
        assert [n["id"] for n in client.get("/api/nodes?query=Test Proj").json()] == [sample_project.id]


class TestStatusIsAFilter:
    def test_null_status_is_nameable(self, client, db):
        """A NULL status is a real state — the disagreement ADR-0141 closed came from
        exactly those rows — so a filter that cannot name it hides the set most worth
        looking at. An omitted filter and a filter for the absent value are different
        questions, which is why the token is ``none`` and not an empty string."""
        _mk(db, id="s-none", type=graph.NODE_TASK, title="stateless", status=None)
        _mk(db, id="s-todo", type=graph.NODE_TASK, title="stated", status="todo")
        assert [n["id"] for n in client.get("/api/nodes?status=none").json()] == ["s-none"]

    def test_empty_segments_are_not_a_status(self, client, db):
        """``status=todo,`` is what a client building the list from a set produces when
        the set is being edited; the trailing empty segment must not become a filter for
        the empty string, which nothing has."""
        _mk(db, id="s-trail", type=graph.NODE_TASK, title="trailing", status="todo")
        assert [n["id"] for n in client.get("/api/nodes?status=todo,").json()] == ["s-trail"]
        assert node_listing.parse_statuses(",") is None

    def test_several_statuses_are_a_union(self, client, db):
        _mk(db, id="s-done", type=graph.NODE_TASK, title="a", status="done")
        _mk(db, id="s-failed", type=graph.NODE_TASK, title="b", status="failed")
        _mk(db, id="s-todo2", type=graph.NODE_TASK, title="c", status="todo")
        got = {n["id"] for n in client.get("/api/nodes?status=done,failed").json()}
        assert got == {"s-done", "s-failed"}


class TestOrderIsAQuestion:
    def test_recent_puts_the_last_touched_first(self, client, db):
        from datetime import datetime

        _mk(db, id="old", type=graph.NODE_TASK, title="old", updated_at=datetime(2020, 1, 1))
        _mk(db, id="new", type=graph.NODE_TASK, title="new", updated_at=datetime(2030, 1, 1))
        assert [n["id"] for n in client.get("/api/nodes?sort=recent").json()][0] == "new"

    def test_created_is_newest_first(self, client, db):
        from datetime import datetime

        _mk(db, id="c-old", type=graph.NODE_TASK, title="z first alphabetically", created_at=datetime(2020, 1, 1))
        _mk(db, id="c-new", type=graph.NODE_TASK, title="a last alphabetically", created_at=datetime(2030, 1, 1))
        ids = [n["id"] for n in client.get("/api/nodes?sort=created").json()]
        assert ids.index("c-new") < ids.index("c-old")

    def test_title_sorts_case_insensitively(self, client, db):
        """SQLite's default collation is case-sensitive and PostgreSQL's is not, so the
        unlowered order differs between the two targets the suite treats as co-equal
        (ADR-0018) — which would make this assertion pass on one and fail on the other."""
        _mk(db, id="t-upper", type=graph.NODE_TASK, title="ZEBRA sorts last")
        _mk(db, id="t-lower", type=graph.NODE_TASK, title="apple sorts first")
        ids = [n["id"] for n in client.get("/api/nodes?sort=title").json()]
        assert ids.index("t-lower") < ids.index("t-upper")

    def test_an_unknown_sort_is_refused_rather_than_ignored(self, client):
        """Silently falling back would make the control a decoration."""
        r = client.get("/api/nodes?sort=whenever")
        assert r.status_code == 422
        assert "whenever" in r.json()["detail"]


class TestTheCountIsCounted:
    def test_facets_report_the_whole_filtered_set_not_the_page(self, client, db):
        for i in range(7):
            _mk(db, id=f"f{i}", type=graph.NODE_TASK, title=f"facet {i}", status="todo" if i % 2 else None)
        facets = client.get("/api/nodes/facets?query=facet").json()
        assert facets["total"] == 7
        assert {f["value"]: f["count"] for f in facets["status"]} == {"todo": 3, None: 4}

    def test_status_counts_ignore_the_status_filter(self, client, db):
        """The counts beside the picker have to be counts of the set you would get *by
        switching to* that status; computed with the filter applied they would collapse
        to the one row already selected and there would be nothing to switch to."""
        for i in range(4):
            _mk(db, id=f"g{i}", type=graph.NODE_TASK, title=f"gauge {i}", status="todo" if i % 2 else "done")
        facets = client.get("/api/nodes/facets?query=gauge&status=todo").json()
        assert facets["total"] == 2
        assert {f["value"]: f["count"] for f in facets["status"]} == {"todo": 2, "done": 2}

    def test_loose_is_counted_before_it_is_applied(self, client, db, sample_identity, sample_project):
        """It was a checkbox with no number (ADR-0154), so the only way to learn whether
        anything was loose was to tick it — on the one filter whose whole job is to
        surface what you did not know was there."""
        _mk(db, id="adrift-1", type=graph.NODE_TASK, title="adrift one")
        facets = client.get("/api/nodes/facets").json()
        assert facets["loose"] >= 2  # the unfiled project and the stray task
        assert facets["loose"] < facets["total"]

    def test_the_loose_count_ignores_only_its_own_filter(self, client, db, sample_project):
        """Every other narrowing still applies, or the number beside the row would not
        describe the set you would land in by ticking it."""
        _mk(db, id="filed-todo", type=graph.NODE_TASK, title="counted", status="todo")
        both = client.get("/api/nodes/facets?query=counted").json()
        assert both["total"] == 1 and both["loose"] == 1
        # Narrowing to a status the loose node does not have empties the loose count too.
        assert client.get("/api/nodes/facets?query=counted&status=done").json()["loose"] == 0

    def test_facets_is_not_swallowed_by_the_id_route(self, client):
        """Routing is first-match and neither declaration reveals the conflict — only
        the order in the file does (ADR-0086)."""
        assert client.get("/api/nodes/facets").status_code == 200


class TestEdgeCountsAreBatched:
    def test_both_directions_count(self, client, db, sample_project, sample_identity):
        loose = _mk(db, id="lonely", type=graph.NODE_TASK, title="lonely")
        counts = client.get(f"/api/graph/edge-counts?ids={sample_project.id},{loose.id}").json()
        assert counts[loose.id] == 0
        # The project is owned by the identity and contains nothing yet; the owning edge
        # points *at* it, so a source-only count would report zero here.
        assert counts[sample_project.id] >= 1

    def test_an_unknown_id_is_zero_not_missing(self, client):
        """A missing entry renders as "connected to nothing", which is a claim."""
        assert client.get("/api/graph/edge-counts?ids=nope").json() == {"nope": 0}


class TestBothDoorsAnswerTheSameQuestion:
    """The v1 copy was a hand-written second implementation that had already drifted:
    it could not ask for loose nodes, could not page past its own cap, and could not
    order or narrow by status. Same service now, so the only differences left are the
    ones that belong to a door — scope, and what the key may see."""

    @pytest.mark.parametrize(
        "query",
        ["sort=recent", "status=none", "unfiled=true", "offset=1", "query=parity"],
    )
    def test_the_two_doors_return_the_same_ids(self, client, db, admin_key, query):
        for i in range(3):
            _mk(db, id=f"p{i}", type=graph.NODE_TASK, title=f"parity {i}", status=None if i else "todo")
        internal = client.get(f"/api/nodes?{query}").json()
        external = client.get(f"/api/v1/nodes?{query}", headers={"X-API-Key": admin_key}).json()
        assert [n["id"] for n in internal] == [n["id"] for n in external]

    def test_the_refusal_matches_too(self, client, admin_key):
        internal = client.get("/api/nodes?sort=bogus")
        external = client.get("/api/v1/nodes?sort=bogus", headers={"X-API-Key": admin_key})
        assert internal.status_code == external.status_code == 422
        assert internal.json()["detail"] == external.json()["detail"]


class TestLooseSpansBothAxes:
    """ADR-0150 defined loose as "nothing above it and nothing below it" and then asked
    about containment only. Production's hierarchy is built on the other axis — an
    identity *owns* its projects rather than containing them — so every identity landed
    back in the inbox this rule exists to empty, one of them owning twenty-one projects,
    under the same hint about filing it under something."""

    def test_an_identity_that_owns_projects_is_not_loose(self, client, db, sample_identity, sample_project):
        loose = {n["id"] for n in client.get("/api/nodes?unfiled=true&limit=500").json()}
        assert sample_identity.id not in loose

    def test_being_owned_does_not_file_you(self, client, db, sample_identity, sample_project):
        """Only the outgoing direction counts. Ownership says whose a thing is, not where
        it lives (ADR-0078), so a project somebody owns and nobody filed is still loose —
        which is most of what this filter finds."""
        loose = {n["id"] for n in client.get("/api/nodes?unfiled=true&limit=500").json()}
        assert sample_project.id in loose

    def test_a_node_with_nothing_at_all_is_loose(self, client, db):
        _mk(db, id="adrift", type=graph.NODE_TASK, title="adrift")
        assert "adrift" in {n["id"] for n in client.get("/api/nodes?unfiled=true&limit=500").json()}
