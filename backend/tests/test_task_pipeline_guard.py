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

from tests.source_scan import function_calls

APP_DIR = Path(__file__).resolve().parent.parent / "app"

# Matched per *function*, not per file. A module-wide check lets one correct call site
# excuse every other write in the same file, which is not a hypothetical: the node
# create endpoints wrote a `contains` edge and never dispatched it, and passed this
# guard for as long as an unrelated endpoint further down the file did dispatch. So
# `edge.added` never fired for the one moment a node is filed into a container.
# Dotted where the call goes through the package, bare for a direct import. Both
# spellings are listed so neither reaches the pipeline unnoticed — and the dotted
# form is what keeps `asyncio.create_task` out of a guard about `graph.create_task`.
DIRECT_WRITE = {"graph.create_task", "graph.update_task", "create_task", "update_task"}
PIPELINE_CALL = {"finalize_task_create", "apply_task_update"}

_EDGE_FUNCS = ("set_label", "unset_label", "add_to_cycle", "remove_from_cycle", "add_edge", "remove_edge")
EDGE_WRITE = {f"graph.{n}" for n in _EDGE_FUNCS} | set(_EDGE_FUNCS)
EDGE_DISPATCH = {"dispatch_edge_added", "dispatch_edge_removed"}

# Kept as regexes for the staleness checks, which ask a whole-file question.
DIRECT_WRITE_RE = re.compile(r"graph\.(create_task|update_task)\(")
EDGE_WRITE_RE = re.compile(r"graph\.(set_label|unset_label|add_to_cycle|remove_from_cycle|add_edge|remove_edge)\(")
EDGE_DISPATCH_RE = re.compile(r"dispatch_edge_(added|removed)\(")

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
    # Creation-time containment is an *input* to the node event, not a second event.
    # The edge is written before dispatch precisely so the pipeline can resolve the
    # node's project from it; dispatching it as well would log a membership *change*
    # for a node that was created there, which `test_edge_dispatch` pins at exactly one
    # entry. A rule wanting "work arrived in this container" keys on node.created.
    #
    # Function-scoped: both files dispatch edges correctly everywhere else, and a
    # file-level exemption would excuse those too.
    "routers/nodes.py::create_node": "creation-time containment is announced by dispatch_node_created",
    "routers/external_api/nodes.py::api_create_node": (
        "creation-time containment is announced by dispatch_node_created"
    ),
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
    # Function-scoped: the rest of this module does use the pipeline, so a file-level
    # exemption would excuse every other tool in it. Its reason lived only in a
    # docstring until the guard became function-granular and asked.
    "services/assistant_tools.py::_tool_report_progress": (
        "progress_pct/agent_notes only — same intentional bypass as external_api/progress.py"
    ),
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
        groups = function_calls(path.read_text(), {"write": DIRECT_WRITE, "pipeline": PIPELINE_CALL})
        for func, calls in groups.items():
            # ALLOWED keys are `file` or `file::function` — the line number in `func`
            # is for the message only, so an exemption does not rot when code moves.
            if f"{rel}::{func.rsplit(':', 1)[0]}" in ALLOWED:
                continue
            if calls["write"] and not calls["pipeline"]:
                offenders.append(f"{rel}::{func}")

    assert not offenders, (
        "These modules write tasks directly without running the task pipeline, so "
        "workflow rules, notifications and broadcasts are silently skipped: "
        f"{offenders}. Route the write through services/task_mutations, or add the "
        "file to ALLOWED with the reason it cannot trigger a rule."
    )


def test_allowed_entries_are_not_stale():
    """An exemption that no longer has a direct write is dead weight — drop it."""
    stale = [rel for rel in ALLOWED if not DIRECT_WRITE_RE.search((APP_DIR / rel.split("::")[0]).read_text())]
    assert not stale, f"ALLOWED lists files with no direct task write any more: {stale}"


def test_direct_edge_writes_are_paired_with_the_dispatcher():
    offenders = []
    for path in _source_files():
        rel = path.relative_to(APP_DIR).as_posix()
        if rel in EDGE_ALLOWED:
            continue
        groups = function_calls(path.read_text(), {"write": EDGE_WRITE, "dispatch": EDGE_DISPATCH})
        for func, calls in groups.items():
            # Keys are `file` or `file::function`; the line number is message-only.
            if f"{rel}::{func.rsplit(':', 1)[0]}" in EDGE_ALLOWED:
                continue
            if calls["write"] and not calls["dispatch"]:
                offenders.append(f"{rel}::{func}")

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
        text = (APP_DIR / rel.split("::")[0]).read_text()
        if not EDGE_WRITE_RE.search(text):
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
    # notifier owns named-event triggers (ADR-0106): _deliver is the one place every
    # fire_notifications/fire_project_notifications/fire_node_notifications call funnels
    # through, so it is the single dispatch point for that trigger kind too — the same
    # "not scattered per-caller" invariant this guard enforces, extended to a third kind.
    assert callers == {
        "services/task_mutations.py",
        "services/graph_dispatch.py",
        "services/notifier.py",
    }, f"run_rules must only be called from a dispatcher, but found: {sorted(callers)}"
