#!/usr/bin/env python3
"""Cross-check the URLs this project publishes against the routes the app declares.

Usage: python3 scripts/check_documented_urls.py [repo-root]

`174d498` moved every frontend route off the `/app` prefix to the root, and nothing
downstream followed. `/app` kept answering 200 — nginx serves index.html for any SPA
path — so the shell and sidebar rendered and the routed content was blank. That state
survived two months in README.md, CLAUDE.md, CONTRIBUTING.md, two docs pages, the
setup script, and every e2e test, because nothing compared the URLs the project hands
out against the routes it actually has.

Lives here rather than in the vitest suite because the frontend container is mounted
at /app and cannot see the repo root, and in CI it runs the same way
check_api_docs.py does: the inputs are copied into a container that has Python.

Exits non-zero if a documented URL, or an e2e `page.goto`, names a path no route matches.
"""

import re
import sys
from pathlib import Path

DOC_FILES = [
    "README.md",
    "CLAUDE.md",
    ".github/CONTRIBUTING.md",
    "docs/local-setup.md",
    "docs/deployment.md",
    "scripts/setup.sh",
]

# Backend contracts and external surfaces — not SPA routes, so not this check's business.
NOT_SPA = ("/health", "/docs", "/redoc", "/openapi", "/mcp", "/api", "/webhook", "/share", "/ical", "/ws")

DEV_URL = re.compile(r"http://localhost:5173(/[^\s`\"'),]*)?")
ROUTE_DECL = re.compile(r'<Route\s+path="([^"]+)"')
GOTO = re.compile(r"""page\.goto\(\s*[`'"]([^`'"]+)[`'"]""")


def declared_routes(app_jsx: Path) -> set[str]:
    source = app_jsx.read_text()
    routes = {"/"} if "<Route" in source and "index" in source else set()
    for raw in ROUTE_DECL.findall(source):
        if raw in ("/*", "*"):
            continue
        routes.add(raw if raw.startswith("/") else f"/{raw}")
    return routes


def matches(path: str, routes: set[str]) -> bool:
    if path in routes:
        return True
    given = [p for p in path.split("/") if p]
    for route in routes:
        segs = [p for p in route.split("/") if p]
        if len(segs) == len(given) and all(s.startswith(":") or s == given[i] for i, s in enumerate(segs)):
            return True
    return False


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    routes = declared_routes(root / "frontend/src/App.jsx")

    # Anti-vacuity: a refactor of how routes are declared must not silently turn this
    # into a check over an empty set.
    if len(routes) < 15:
        print(f"only {len(routes)} routes parsed from App.jsx — the parser is stale, not the app")
        return 1

    problems = []
    checked = 0

    for rel in DOC_FILES:
        text = (root / rel).read_text()
        for match in DEV_URL.finditer(text):
            path = match.group(1) or "/"
            if path.startswith(NOT_SPA):
                continue
            checked += 1
            if not matches(path, routes):
                problems.append(f"{rel} publishes {path}, which matches no route")

    for spec in sorted((root / "e2e/tests").glob("*.spec.ts")):
        for raw in GOTO.findall(spec.read_text()):
            path = re.sub(r"\$\{[^}]+\}", "x", raw)
            if not path.startswith("/") or path.startswith(NOT_SPA):
                continue
            checked += 1
            if not matches(path, routes):
                problems.append(f"e2e/tests/{spec.name} navigates to {path}, which matches no route")

    if checked < 4:
        print(f"only {checked} URLs found to check — the patterns are stale")
        return 1

    for problem in problems:
        print(problem)
    print(f"\n{len(routes)} routes declared, {checked} published URLs checked, {len(problems)} broken")
    if problems:
        print("Such a URL still answers 200: nginx serves index.html, the shell renders, the content is blank.")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
