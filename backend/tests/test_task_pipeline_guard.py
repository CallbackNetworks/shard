"""Guard: task and edge writes run their dispatchers (ADR-0038/0044/0045).

``graph.create_task`` and ``graph.update_task`` write the node and nothing else.
The activity log, workflow rules, outbound notifications, external issue sync and
WebSocket broadcast live in ``services/task_mutations``. A caller that writes the
node directly and skips the pipeline produces a task that exists but that no rule
ever saw and no integration was ever told about — a silent behaviour fork, not a
crash, so no functional test catches it.

This test enumerates the direct call sites and fails when a new one appears
without an accompanying pipeline call. Adding a genuinely field-only write (one
that cannot trigger a rule or a notification) means adding it to ``ALLOWED``
with the reason spelled out.

``services/graph_dispatch`` plays the same role for relationships (ADR-0045):
writing a ``labeled``/``in_cycle``/``depends_on``/``contains`` edge without
dispatching it skips the outbound sync, the activity entry and the broadcast,
so the second guard below holds edge writers to the same standard.

``services/rules_engine`` used to hold an exemption from both, on the grounds that it
runs inside a dispatch already. That was the bypass: a rule's own changes were invisible
to everything downstream. It now goes through both surfaces with ``trigger_rules=False``,
which stops the recursion the exemption was really about (ADR-0048), so both exemptions
are gone.
"""

import re
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent / "app"

DIRECT_WRITE = re.compile(r"graph\.(create_task|update_task)\(")
PIPELINE_CALL = re.compile(r"(finalize_task_create|apply_task_update)\(")

EDGE_WRITE = re.compile(r"graph\.(set_label|unset_label|add_to_cycle|remove_from_cycle|add_edge|remove_edge)\(")
EDGE_DISPATCH = re.compile(r"dispatch_edge_(added|removed)\(")

# Files that write edges but legitimately never dispatch, with the reason.
EDGE_ALLOWED = {
    # Inbound direction of the external sync: dispatching would push the same
    # change straight back out to the provider it just came from (ADR-0014).
    "routers/issue_sync.py": "applies inbound provider state; must not echo it back",
    # Labels are attached before the task exists as far as listeners are
    # concerned; finalize_task_create then announces the finished task.
    # (Moved out of routers/imports.py by ADR-0092, which gave the importers a v1 door.)
    "services/task_import.py": "importer attaches labels before finalize_task_create",
    # Same shape: the clone is linked into its new cycle before finalize_task_create, so
    # cycle-scoped rules see it where it belongs (moved from routers/cycles.py, ADR-0092).
    "services/cycle_admin.py": "cycle clone joins the new cycle before finalize_task_create",
}

# Files exempt from needing a pipeline call, with the reason they are exempt.
ALLOWED = {
    # The pipeline itself.
    "services/task_mutations.py": "is the pipeline",
    # Writes only bookkeeping fields that no rule or notification keys off:
    # reminder_sent_at, callback_token, external_* linkage, progress fields.
    "services/scheduler.py": "reminder_sent_at bookkeeping (recurrence uses the pipeline)",
    # `routers/tasks.py` was here for "callback_token regeneration only". It no longer
    # writes a task at all: the rotation moved to `services/webhook_credentials`, which the
    # internal node route and `/api/v1` share (ADR-0085), and this guard is what noticed.
    "routers/issue_sync.py": "external_* linkage (inbound events use the pipeline)",
    "routers/external_api/progress.py": "progress_pct/agent_notes only",
}


def _source_files():
    for path in sorted(APP_DIR.rglob("*.py")):
        if "__pycache__" in path.parts or path.parts[-2:-1] == ("graph",):
            continue
        yield path


def test_direct_task_writes_are_paired_with_the_pipeline():
    offenders = []
    for path in _source_files():
        rel = path.relative_to(APP_DIR).as_posix()
        if rel in ALLOWED:
            continue
        text = path.read_text()
        if DIRECT_WRITE.search(text) and not PIPELINE_CALL.search(text):
            offenders.append(rel)

    assert not offenders, (
        "These modules write tasks directly without running the task pipeline, so "
        "workflow rules, notifications and broadcasts are silently skipped: "
        f"{offenders}. Route the write through services/task_mutations, or add the "
        "file to ALLOWED with the reason it cannot trigger a rule."
    )


def test_allowed_entries_are_not_stale():
    """An exemption that no longer has a direct write is dead weight — drop it."""
    stale = [rel for rel in ALLOWED if not DIRECT_WRITE.search((APP_DIR / rel).read_text())]
    assert not stale, f"ALLOWED lists files with no direct task write any more: {stale}"


def test_direct_edge_writes_are_paired_with_the_dispatcher():
    offenders = []
    for path in _source_files():
        rel = path.relative_to(APP_DIR).as_posix()
        if rel in EDGE_ALLOWED:
            continue
        text = path.read_text()
        if EDGE_WRITE.search(text) and not EDGE_DISPATCH.search(text):
            offenders.append(rel)

    assert not offenders, (
        "These modules write relationship edges without dispatching them, so outbound "
        f"sync, activity and broadcasts are silently skipped: {offenders}. Call "
        "services/graph_dispatch.dispatch_edge_added/removed, or add the file to "
        "EDGE_ALLOWED with the reason."
    )


def test_edge_allowed_entries_are_not_stale():
    """An exemption is dead weight once the file stops writing edges — or starts dispatching."""
    stale = []
    for rel in EDGE_ALLOWED:
        text = (APP_DIR / rel).read_text()
        if not EDGE_WRITE.search(text) or EDGE_DISPATCH.search(text):
            stale.append(rel)
    assert not stale, f"EDGE_ALLOWED lists files that no longer need the exemption: {stale}"


def test_run_rules_is_only_called_from_a_dispatcher():
    """Rule evaluation must live in the dispatchers, or triggers drift per-caller."""
    callers = set()
    for path in _source_files():
        rel = path.relative_to(APP_DIR).as_posix()
        if rel == "services/rules_engine.py":
            continue
        if re.search(r"\brun_rules\(", path.read_text()):
            callers.add(rel)

    # task_mutations owns the node triggers; graph_dispatch owns task.label_added,
    # which is an edge transition and has no node-level equivalent (ADR-0045).
    assert callers == {
        "services/task_mutations.py",
        "services/graph_dispatch.py",
    }, f"run_rules must only be called from a dispatcher, but found: {sorted(callers)}"
