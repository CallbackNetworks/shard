"""A container-scoped key's reach narrows the query, not the page it produced.

Both node listings applied the visibility check *after* ``.limit()``. The effect was
not a leak — nothing out of scope was ever returned — but a caller asking for N rows
received however many of the first N happened to be in scope, with no way to tell a
short page from the end of the graph. Ten in-scope nodes behind twenty out-of-scope
ones came back empty at ``limit=20``.
"""

import hashlib

import pytest

from app.models import ApiKey
from app.services import graph
from tests.factories import make_project, make_task


def _scoped_key(db, container_id, name="scoped"):
    raw = f"tdp_test_{name}"
    db.add(
        ApiKey(
            name=name,
            key_hash=hashlib.sha256(raw.encode()).hexdigest(),
            key_last4=raw[-4:],
            scopes=["read"],
            container_id=container_id,
            active=True,
        )
    )
    db.commit()
    return raw


@pytest.fixture()
def crowded_graph(db):
    """One project the key may see, behind a pile of older ones it may not.

    Creation order matters: both endpoints order by a column the out-of-scope nodes
    win on, so a limit applied before the scope filter consumes the whole page.
    """
    noise = [make_project(db, name=f"Noise {i}") for i in range(20)]
    db.commit()

    mine = make_project(db, name="Mine")
    db.commit()
    tasks = [make_task(db, project_id=mine.id, title=f"Task {i}") for i in range(5)]
    db.add_all(tasks)
    db.commit()
    return mine, noise, tasks


class TestGraphMap:
    def test_a_full_page_of_out_of_scope_nodes_does_not_empty_the_result(self, client, db, crowded_graph):
        mine, _noise, _tasks = crowded_graph
        raw = _scoped_key(db, mine.id, "map_scoped")

        body = client.get("/api/v1/graph/map?limit=20", headers={"X-API-Key": raw}).json()

        titles = {n["title"] for n in body["nodes"]}
        assert "Mine" in titles
        assert titles == {"Mine"} | {f"Task {i}" for i in range(5)}

    def test_returns_nothing_out_of_scope(self, client, db, crowded_graph):
        mine, _noise, _tasks = crowded_graph
        raw = _scoped_key(db, mine.id, "map_scoped2")

        body = client.get("/api/v1/graph/map?limit=5000", headers={"X-API-Key": raw}).json()

        assert not [n for n in body["nodes"] if n["title"].startswith("Noise")]

    def test_an_unrestricted_key_still_sees_everything(self, client, db, crowded_graph):
        raw = _scoped_key(db, None, "map_unrestricted")
        body = client.get("/api/v1/graph/map?limit=5000", headers={"X-API-Key": raw}).json()
        assert len([n for n in body["nodes"] if n["title"].startswith("Noise")]) == 20

    def test_edges_stay_within_the_returned_nodes(self, client, db, crowded_graph):
        mine, _noise, _tasks = crowded_graph
        raw = _scoped_key(db, mine.id, "map_scoped3")

        body = client.get("/api/v1/graph/map?limit=5000", headers={"X-API-Key": raw}).json()

        ids = {n["id"] for n in body["nodes"]}
        assert all(e["source_id"] in ids and e["target_id"] in ids for e in body["edges"])


class TestNodeListing:
    def test_a_full_page_of_out_of_scope_nodes_does_not_empty_the_result(self, client, db, crowded_graph):
        mine, _noise, _tasks = crowded_graph
        raw = _scoped_key(db, mine.id, "list_scoped")

        rows = client.get("/api/v1/nodes?limit=20", headers={"X-API-Key": raw}).json()

        assert rows, "a scoped key asking for 20 rows got none of its 6 visible nodes"
        assert {r["title"] for r in rows} == {"Mine"} | {f"Task {i}" for i in range(5)}

    def test_limit_counts_rows_the_caller_can_see(self, client, db, crowded_graph):
        mine, _noise, _tasks = crowded_graph
        raw = _scoped_key(db, mine.id, "list_scoped2")

        rows = client.get("/api/v1/nodes?limit=3", headers={"X-API-Key": raw}).json()

        assert len(rows) == 3
        assert all(not r["title"].startswith("Noise") for r in rows)


class TestAKeyScopedToNothingReachableSeesNothing:
    def test_graph_map_is_empty(self, client, db, crowded_graph):
        mine, _noise, _tasks = crowded_graph
        empty = make_project(db, name="Empty")
        db.commit()
        raw = _scoped_key(db, empty.id, "empty_scoped")

        body = client.get("/api/v1/graph/map?limit=100", headers={"X-API-Key": raw}).json()

        assert [n["title"] for n in body["nodes"]] == ["Empty"]
        assert body["edges"] == []


class TestTheTwoAccessChecksAgree:
    """`_visible_node_ids` is the set-shaped twin of `_node_accessible`."""

    def test_they_answer_the_same_for_every_node(self, db, crowded_graph):
        from app.models import ApiKey as Key
        from app.routers.external_api.auth import _node_accessible, _visible_node_ids

        mine, noise, tasks = crowded_graph
        key = Key(name="probe", key_hash="x", key_last4="xxxx", scopes=["read"], container_id=mine.id, active=True)

        visible = _visible_node_ids(db, key)
        for node in [mine, *noise, *tasks]:
            assert (node.id in visible) is _node_accessible(key, db, node), node.title

    def test_an_unrestricted_key_is_none_not_an_empty_set(self, db):
        from app.models import ApiKey as Key
        from app.routers.external_api.auth import _visible_node_ids

        key = Key(name="probe", key_hash="x", key_last4="xxxx", scopes=["read"], active=True)
        assert _visible_node_ids(db, key) is None


class TestAncestorsOfIsStillOrderedBreadthFirst:
    """The batched walk must not change what callers reading it see."""

    def test_a_chain_comes_back_nearest_first(self, db):
        root = graph.create_node(db, "container", title="Root")
        mid = graph.create_node(db, "container", title="Mid")
        leaf = graph.create_node(db, "container", title="Leaf")
        graph.add_edge(db, root.id, mid.id, "contains")
        graph.add_edge(db, mid.id, leaf.id, "contains")
        db.commit()

        assert [n.title for n in graph.ancestors_of(db, leaf.id)] == ["Mid", "Root"]

    def test_multiple_parents_all_appear_once(self, db):
        a = graph.create_node(db, "container", title="A")
        b = graph.create_node(db, "container", title="B")
        shared = graph.create_node(db, "container", title="Shared")
        graph.add_edge(db, a.id, shared.id, "contains")
        graph.add_edge(db, b.id, shared.id, "contains")
        db.commit()

        names = [n.title for n in graph.ancestors_of(db, shared.id)]
        assert sorted(names) == ["A", "B"]
        assert len(names) == len(set(names))

    def test_a_cycle_terminates(self, db):
        """add_edge refuses cycles, but the walk must not depend on that."""
        one = graph.create_node(db, "container", title="One")
        two = graph.create_node(db, "container", title="Two")
        graph.add_edge(db, one.id, two.id, "contains")
        db.commit()

        assert [n.title for n in graph.ancestors_of(db, two.id)] == ["One"]
