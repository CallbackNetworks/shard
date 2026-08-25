"""Guard: every `/api/v1` route checks a scope (ADR-0084/0085/0086/0107).

An API key carries `read` / `write` / `admin`, and every v1 handler enforces that by
calling `_require_scope` as its first statement. All 141 of them do — but only because
someone has written the line 141 times, and nothing verifies the 142nd.

That is the one important invariant in this codebase without a static check on it,
which is out of character: the unauthenticated surface, the MCP registry, the task
pipeline, the task-type reach and the overdue definition all have one. The mechanism
this uses already existed for those (`tests/source_scan.py`).

A missing call is not a visible failure. The endpoint works, returns the right data,
and passes any functional test written for it — it simply does so for a `read` key that
should not have been able to reach it. `CredentialRedactionMiddleware`'s own docstring
rejects exactly this shape of protection for redaction ("a rule applied per-endpoint is
one a new endpoint can simply be written without"); the scopes are that shape and were
left unguarded.
"""

import ast
from pathlib import Path

from tests.source_scan import function_calls

V1_DIR = Path(__file__).resolve().parent.parent / "app" / "routers" / "external_api"

HTTP_METHODS = {"get", "post", "put", "patch", "delete"}
SCOPE_CALLS = {"_require_scope"}

# Handlers that legitimately enforce access some other way, with the reason.
#
# Empty on purpose. Every v1 route today takes a scope, and an entry here should have
# to argue for itself — "this one is public" is a claim about the external API's
# security boundary, not a formatting exception.
SCOPE_EXEMPT: dict[str, str] = {}


def _route_handlers():
    """Every function in external_api/ decorated as an HTTP route, as (rel, name, line)."""
    for path in sorted(V1_DIR.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        rel = path.relative_to(V1_DIR).as_posix()
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
                continue
            for decorator in node.decorator_list:
                call = decorator.func if isinstance(decorator, ast.Call) else decorator
                if isinstance(call, ast.Attribute) and call.attr in HTTP_METHODS:
                    yield rel, node.name, node.lineno
                    break


def test_every_v1_route_checks_a_scope():
    handlers = list(_route_handlers())
    scanned = {
        path.relative_to(V1_DIR).as_posix(): function_calls(path.read_text(), {"scope": SCOPE_CALLS})
        for path in sorted(V1_DIR.rglob("*.py"))
        if "__pycache__" not in path.parts
    }

    offenders = []
    for rel, name, lineno in handlers:
        if f"{rel}::{name}" in SCOPE_EXEMPT:
            continue
        if not scanned[rel].get(f"{name}:{lineno}", {}).get("scope"):
            offenders.append(f"{rel}::{name}:{lineno}")

    assert not offenders, (
        "These /api/v1 routes never call _require_scope, so any valid key reaches them "
        f"regardless of its scopes: {offenders}. Add the check, or add the handler to "
        "SCOPE_EXEMPT with the reason it is safe without one."
    )


def test_the_guard_actually_found_the_routes():
    """Anti-vacuity: a decorator rename would otherwise make this pass on an empty set."""
    handlers = list(_route_handlers())
    assert len(handlers) > 100, f"expected the full v1 surface, found {len(handlers)} handlers"


def test_exemptions_are_not_stale():
    """An exemption for a handler that no longer exists is a claim about nothing."""
    live = {f"{rel}::{name}" for rel, name, _ in _route_handlers()}
    stale = sorted(set(SCOPE_EXEMPT) - live)
    assert not stale, f"SCOPE_EXEMPT names handlers that are gone: {stale}"
