"""Helpers for the guard tests that read the backend's own source.

Several vocabularies in this codebase are free strings that the engine matches against
a set: an unrecognised value means "no match" / "do nothing", *silently*. A runtime
assertion cannot catch that, because the offending call is exactly the one that never
runs. So the guards read the source instead and pin each declared value to a real call
site (ADR-0044, ADR-0047, ADR-0048).

They all need the same thing: find the calls to a handful of functions, and pull an
argument out of each one. That is what lives here.
"""

import ast
import re
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent / "app"


def app_sources() -> list[tuple[Path, str]]:
    """Every backend module, as (path, text)."""
    return [(path, path.read_text()) for path in sorted(APP_DIR.rglob("*.py"))]


def call_args(source: str, start: int) -> str:
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


def _split_args(args: str) -> list[str]:
    """Split argument text on the commas that separate arguments.

    Depth-aware, so a nested call's or a tuple's commas do not split it.
    """
    parts, depth, current = [], 0, ""
    for ch in args:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(current)
            current = ""
        else:
            current += ch
    parts.append(current)
    return [p.strip() for p in parts if p.strip()]


_KEYWORD = re.compile(r"^([A-Za-z_]\w*)\s*=[^=]")


def positional_args(args: str) -> list[str]:
    """The positional arguments of a call, keyword arguments dropped.

    The event name is positional and ``source=``/``actor=`` now follow it (ADR-0048),
    so "the last argument" is no longer the same as "the event".
    """
    return [p for p in _split_args(args) if not _KEYWORD.match(p)]


def keyword_arg(args: str, name: str) -> str | None:
    """The text of one keyword argument, or None if the call does not pass it."""
    for part in _split_args(args):
        match = _KEYWORD.match(part)
        if match and match.group(1) == name:
            return part.split("=", 1)[1].strip()
    return None


def calls_to(source: str, *names: str):
    """Yield the argument text of every call to one of ``names`` in ``source``.

    Definitions are skipped, so scanning for ``run_rules`` does not mistake
    ``async def run_rules(db, trigger, ...)`` for a call that fires ``trigger``.
    """
    pattern = re.compile(rf"\b(?:{'|'.join(re.escape(n) for n in names)})\s*\(")
    for match in pattern.finditer(source):
        line_start = source.rfind("\n", 0, match.start()) + 1
        if re.search(r"\bdef\s+$", source[line_start : match.start()]):
            continue
        yield call_args(source, match.start())


def _dotted(node) -> str:
    """`a.b.c` for a nested attribute chain, `a` for a name, `""` for anything else."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _dotted(node.value)
        return f"{base}.{node.attr}" if base else node.attr
    return ""


def function_calls(source: str, name_sets: dict[str, set[str]]) -> dict[str, dict[str, set[str]]]:
    """For each function in ``source``, which of several named call groups it makes.

    Returns ``{"name:line": {"group": {matched names}}}``, so a guard can ask "does the
    function that writes also dispatch" in one pass over the module.

    Parsed rather than regexed because the question is *which function* a call sits in,
    and text has no answer to that. A file-granular guard reads a whole module as one
    scope, so one correct call site anywhere in it excuses every other — which is how an
    undispatched ``contains`` edge sat inside this very guard's blind spot for as long
    as its file happened to contain an unrelated dispatch elsewhere.

    Names match on the attribute or the bare name (``graph.add_edge`` matches
    ``add_edge``), so a module that imports a helper directly is held to the same rule
    as one that reaches it through a package.
    """
    tree = ast.parse(source)
    out: dict[str, dict[str, set[str]]] = {}
    local_calls: dict[str, set[str]] = {}
    by_name: dict[str, list[str]] = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            continue
        called = set()
        for inner in ast.walk(node):
            if not isinstance(inner, ast.Call):
                continue
            func = inner.func
            if isinstance(func, ast.Attribute):
                # Dotted, so `graph.create_task` is not confused with
                # `asyncio.create_task` — a collision that flagged seven innocent
                # functions the first time this was written on the bare name alone.
                called.add(f"{_dotted(func.value)}.{func.attr}" if _dotted(func.value) else func.attr)
            elif isinstance(func, ast.Name):
                # Bare only for a direct import (`from ...graph import create_task`).
                called.add(func.id)
        out[f"{node.name}:{node.lineno}"] = {group: called & names for group, names in name_sets.items()}
        local_calls[f"{node.name}:{node.lineno}"] = called
        by_name.setdefault(node.name, []).append(f"{node.name}:{node.lineno}")

    # A function that delegates to a module-local helper inherits what the helper does.
    # Without this, splitting a write and its dispatch across two functions in the same
    # module reads as a bypass — which it is not: `import_trello` writes the task and
    # hands off to `_attach_labels_and_finalize`, which runs the pipeline. Iterated to a
    # fixpoint so a two-hop delegation counts as well.
    changed = True
    while changed:
        changed = False
        for key, calls in local_calls.items():
            for callee_name in calls:
                for callee_key in by_name.get(callee_name, ()):
                    if callee_key == key:
                        continue
                    for group, matched in out[callee_key].items():
                        if matched - out[key][group]:
                            out[key][group] |= matched
                            changed = True
    return out
