"""The advertised notification event list must match what is actually delivered.

Five of the events the UI offered were never passed to ``fire_notifications``: ticking
them subscribed you to nothing and said nothing. The list now lives in one place, is
served to every consumer, and these tests keep it pinned to real fire sites (ADR-0047).
"""

import re
from pathlib import Path

import pytest

from app.routers.external_api.subscriptions import ALL_EVENTS
from app.services.notifier import NOTIFICATION_EVENTS

BACKEND = Path(__file__).resolve().parent.parent

# Functions that actually deliver an event, plus the thin dispatcher wrapper that takes
# the event name from its caller. Add yours here if you introduce another wrapper.
FIRE_FUNCTIONS = ("fire_notifications", "fire_project_notifications", "_fire_project_event")
EVENT_LITERAL = re.compile(r'"([a-z]+\.[a-z_]+)"')


def _call_args(source: str, start: int) -> str:
    """Text between the parentheses of the call beginning at ``start``.

    A regex cannot do this: ``fire_notifications(db, graph.task_view(task, db), "x")``
    has a nested call, so matching up to the first ``)`` loses the event.
    """
    open_at = source.index("(", start)
    depth = 0
    for i in range(open_at, len(source)):
        if source[i] == "(":
            depth += 1
        elif source[i] == ")":
            depth -= 1
            if depth == 0:
                return source[open_at + 1 : i]
    return ""


def _fired_events() -> set[str]:
    """Every event name reaching a fire site anywhere in the backend."""
    found: set[str] = set()
    pattern = re.compile(rf"\b(?:{'|'.join(FIRE_FUNCTIONS)})\s*\(")
    for path in (BACKEND / "app").rglob("*.py"):
        source = path.read_text()
        for match in pattern.finditer(source):
            args = _call_args(source, match.start())
            literals = EVENT_LITERAL.findall(args)
            if literals:
                found.update(literals)
                continue
            # The event came in as a variable — resolve it from assignments to that name
            # in the same file (the scheduler picks due_soon vs overdue inline).
            name = args.rsplit(",", 1)[-1].strip()
            if name.isidentifier():
                for assignment in re.findall(rf"^\s*{name}\s*=(.+)$", source, re.M):
                    found.update(EVENT_LITERAL.findall(assignment))
    return found


class TestEveryAdvertisedEventIsFired:
    def test_no_dark_events(self):
        # task.{new_status} is built by interpolation in task_mutations, so the four
        # status events cannot be found by scanning for literals.
        interpolated = {"task.todo", "task.in_progress", "task.done", "task.failed"}
        dark = set(NOTIFICATION_EVENTS) - _fired_events() - interpolated
        assert dark == set(), f"advertised but never fired: {sorted(dark)}"

    def test_no_undeclared_events(self):
        # The rules engine's fire_event action passes a user-supplied value; every
        # other call site must use an event the list advertises.
        extra = _fired_events() - set(NOTIFICATION_EVENTS)
        assert extra == set(), f"fired but not advertised: {sorted(extra)}"


class TestTheCopiesAgree:
    def test_external_api_list_is_the_same_object(self):
        assert ALL_EVENTS is NOTIFICATION_EVENTS

    def test_internal_api_serves_the_list(self, client):
        # The UI renders whatever this returns instead of keeping its own copy.
        r = client.get("/api/integrations/events")
        assert r.status_code == 200
        assert r.json() == NOTIFICATION_EVENTS


class TestSubscriptionsAreValidated:
    def test_integration_rejects_an_unknown_event(self, client):
        r = client.post(
            "/api/integrations",
            json={"name": "n", "type": "webhook", "url": "http://x", "events": ["task.exploded"]},
        )
        assert r.status_code == 422
        assert "task.done" in r.text

    @pytest.mark.parametrize("event", NOTIFICATION_EVENTS)
    def test_integration_accepts_every_advertised_event(self, client, event):
        r = client.post(
            "/api/integrations",
            json={"name": f"n-{event}", "type": "webhook", "url": "http://x", "events": [event]},
        )
        assert r.status_code == 201
