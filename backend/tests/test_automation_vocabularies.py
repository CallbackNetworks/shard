"""The automation's two remaining free-string vocabularies must match the wiring.

``NOTIFICATION_EVENTS`` and the rule condition/action vocabularies are each pinned to
their real call sites by a guard. ``SUPPORTED_TRIGGERS`` and ``NOTIFICATION_SOURCES``
were not, and they fail the same way everything else in this module has failed: the UI
offers the value, the schema accepts it, the write succeeds, and then nothing ever
happens — a fifth trigger nobody wired up, or a ``source="cron"`` that
``normalize_source`` quietly turns into ``"user"``.

These are static scans for the same reason the others are: the bug is a call site that
does not exist, so no runtime assertion can reach it.
"""

import re

from app.services.notifier import (
    _SOURCE_ALIASES,
    DEFAULT_SOURCE,
    NOTIFICATION_SOURCES,
)
from app.services.rules_engine import (
    ACTION_TYPES,
    CONDITION_FIELDS,
    CONDITION_OPS,
    SUPPORTED_TRIGGERS,
)
from app.services.task_mutations import _SOURCE_SUFFIX
from tests.source_scan import app_sources, calls_to, keyword_arg, positional_args

TRIGGER_LITERAL = re.compile(r'"((?:task|node|edge)\.[a-z_]+)"')
STRING_LITERAL = re.compile(r'^"([^"]*)"$')

# Where a trigger is queued rather than passed straight in: apply_task_update collects
# (trigger, context) pairs while it works out what changed, then drains them.
QUEUE_APPEND = re.compile(r"triggered_rules\.append\(\s*\(?\s*\(?\s*\"((?:task|node|edge)\.[a-z_]+)\"")

# Where the trigger is chosen a line before it is passed: the edge dispatcher picks
# between edge.added and edge.removed once and hands the variable to run_rules.
ASSIGNMENT = re.compile(r"^[ \t]*(\w+)[ \t]*=[ \t]*(.+)$", re.M)

# Functions whose ``source=`` argument is a notification source. Scoped deliberately:
# ``source`` is a common parameter name (a label's origin, an assistant decision's
# provenance) and those are different namespaces that must not be checked against this
# vocabulary.
PIPELINE_FUNCTIONS = (
    "apply_task_update",
    "finalize_task_create",
    "fire_notifications",
    "fire_project_notifications",
    "fire_node_notifications",
    "dispatch_node_created",
    "dispatch_node_updated",
    "dispatch_node_deleted",
)
# Of those, the ones that go through task_mutations and so also render an activity suffix.
TASK_PIPELINE_FUNCTIONS = ("apply_task_update", "finalize_task_create")


def _triggers_fired() -> set[str]:
    """Every trigger name that can actually reach ``run_rules``."""
    found: set[str] = set()
    for _path, source in app_sources():
        queued = set(QUEUE_APPEND.findall(source))
        assigned: dict[str, set[str]] = {}
        for name, expression in ASSIGNMENT.findall(source):
            literals = set(TRIGGER_LITERAL.findall(expression))
            if literals:
                assigned.setdefault(name, set()).update(literals)
        for args in calls_to(source, "run_rules"):
            positional = positional_args(args)
            if len(positional) < 2:
                continue
            literals = TRIGGER_LITERAL.findall(positional[1])
            if literals:
                found.update(literals)
            elif positional[1].isidentifier():
                # Named a line earlier: drained from the queue, or chosen by a branch.
                found.update(queued)
                found.update(assigned.get(positional[1], set()))
    return found


def _sources_passed(*functions: str) -> set[str]:
    """Every literal ``source=`` value handed to one of ``functions``."""
    found: set[str] = set()
    for _path, source in app_sources():
        for args in calls_to(source, *functions):
            value = keyword_arg(args, "source")
            if value is None:
                continue
            literal = STRING_LITERAL.match(value)
            if literal:
                found.add(literal.group(1))
    return found


class TestEveryTriggerIsWired:
    """A trigger the UI offers must have somewhere that fires it, and vice versa."""

    def test_no_dark_triggers(self):
        dark = set(SUPPORTED_TRIGGERS) - _triggers_fired()
        assert dark == set(), (
            f"trigger offered but never fired: {sorted(dark)}. A rule saved with it would "
            "sit in the list looking healthy and never run."
        )

    def test_no_undeclared_triggers(self):
        extra = _triggers_fired() - set(SUPPORTED_TRIGGERS)
        assert extra == set(), (
            f"fired but not offered: {sorted(extra)}. Nothing can subscribe to it, because "
            "the schema rejects it at write time."
        )


class TestTheEditorIsServedTheVocabulary:
    """The rule editor must render these lists, not keep a fourth copy of them.

    A hardcoded copy in the frontend is a place to add a trigger the backend does not
    know, which is at least loud (the write 422s) — but also a place to *miss* one the
    backend gained, which is silent.
    """

    def test_the_endpoint_serves_the_engines_vocabulary(self, client):
        r = client.get("/api/workflow-rules/vocabulary")
        assert r.status_code == 200
        body = r.json()
        assert body["triggers"] == SUPPORTED_TRIGGERS
        assert body["condition_fields"] == sorted(CONDITION_FIELDS)
        assert body["condition_ops"] == sorted(CONDITION_OPS)
        assert body["action_types"] == sorted(ACTION_TYPES)

    def test_vocabulary_is_not_shadowed_by_the_rule_id_route(self, client):
        # /workflow-rules/{rule_id} is declared after /vocabulary; if that ever flips,
        # this returns 404 "Rule not found" instead of the vocabulary.
        assert client.get("/api/workflow-rules/vocabulary").json() != {"detail": "Rule not found"}


class TestEverySourceIsProduced:
    """A source the UI offers to filter on must be something the backend actually sends."""

    def test_no_dark_sources(self):
        produced = _sources_passed(*PIPELINE_FUNCTIONS)
        # A source also counts as produced if a finer pipeline source normalizes onto it,
        # or if it is what an unset source falls back to.
        produced.update(normalized for raw, normalized in _SOURCE_ALIASES.items() if raw in _SOURCE_SUFFIX)
        produced.add(DEFAULT_SOURCE)
        dark = set(NOTIFICATION_SOURCES) - produced
        assert dark == set(), (
            f"source offered but never produced: {sorted(dark)}. Selecting it as an "
            "integration's only source would silence that integration entirely."
        )


class TestNoSilentlyDefaultedSource:
    """``normalize_source`` swallows anything it does not know — nothing may rely on that.

    An unmapped value does not raise and does not warn; it becomes ``user``, so a
    scheduler-made change would arrive claiming a person made it, and an integration
    filtering to ``user`` would receive it.
    """

    def test_every_passed_source_is_known(self):
        known = set(NOTIFICATION_SOURCES) | set(_SOURCE_ALIASES)
        unknown = _sources_passed(*PIPELINE_FUNCTIONS) - known
        assert unknown == set(), (
            f"source passed but unknown to normalize_source: {sorted(unknown)}. It would be "
            "delivered as the default and no subscriber could select it."
        )

    def test_every_task_pipeline_source_has_an_activity_suffix(self):
        # _SOURCE_SUFFIX.get(source, "") is the same silent default one layer down: the
        # activity entry just stops saying how the change was made.
        missing = _sources_passed(*TASK_PIPELINE_FUNCTIONS) - set(_SOURCE_SUFFIX)
        assert missing == set(), f"no activity-log suffix for: {sorted(missing)}"

    def test_the_two_vocabularies_line_up(self):
        # Every pipeline source must reach a subscribable one rather than the fallback,
        # and no alias may point at a source the UI does not offer.
        unmapped = set(_SOURCE_SUFFIX) - set(NOTIFICATION_SOURCES) - set(_SOURCE_ALIASES)
        assert unmapped == set(), f"pipeline source with no subscribable equivalent: {sorted(unmapped)}"
        stray = set(_SOURCE_ALIASES.values()) - set(NOTIFICATION_SOURCES)
        assert stray == set(), f"alias points at a source that is not offered: {sorted(stray)}"
