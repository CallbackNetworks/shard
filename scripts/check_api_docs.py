#!/usr/bin/env python3
"""Cross-check docs/api.md against the live OpenAPI spec, in both directions.

Usage: python3 scripts/check_api_docs.py [openapi-url] [path-to-api.md]

The docs path is an argument because CI runs this inside the backend container,
where the repo's docs/ directory is not part of the image — the file is copied in.

Exits non-zero on: a live route outside the known-undocumented baseline, a
documented route that is no longer live, or a baseline entry that has since been
documented (its line has to be removed, so the baseline can only shrink).
"""

import json
import re
import sys
import urllib.request

METHODS = ("GET", "POST", "PATCH", "PUT", "DELETE")
ROOT_PREFIXES = ("/api/v1", "/api/", "/webhook", "/share", "/ical", "/ws", "/health", "/docs", "/openapi", "/redoc")

# Routes named in prose only to say they were retired (ADR-0040 -> ADR-0043, ADR-0085).
RETIRED = {
    ("POST", "/api/projects"),
    ("POST", "/api/projects/{}/tasks"),
    ("POST", "/api/projects/{}/labels"),
    ("POST", "/api/identities"),
    # Moved behind auth by ADR-0085; the docs name the old path to say so.
    ("GET", "/webhook/events/{}"),
}

# Routes that were undocumented when this check was first wired into CI.
#
# Empty, and that is the end state the ratchet existed to reach: it started at 99 of
# 320 live routes and the check refused any addition to it, so the number could only
# go down. It stays here rather than being deleted with its last entry — an empty set
# is the assertion that there is nothing outstanding, and a future gap has to be added
# on purpose rather than inherited.
UNDOCUMENTED_BASELINE: set[tuple[str, str]] = set()


def normalize(path: str) -> str:
    return re.sub(r"\{[^}]*\}", "{}", path.split("?")[0].rstrip(".,"))


def live_routes(url: str) -> set[tuple[str, str]]:
    spec = json.load(urllib.request.urlopen(url))
    return {
        (method.upper(), normalize(path))
        for path, ops in spec["paths"].items()
        for method in ops
        if method.upper() in METHODS
    }


def documented_routes(text: str) -> set[tuple[str, str]]:
    """Parse `GET /x`, and combined headings like `GET`/`POST /x` or `GET /x` · `POST /y`."""
    found = set()
    # Bare method list immediately preceding a path: `GET`/`POST /path`
    pattern = re.compile(r"((?:`?(?:%s)`?\s*/?\s*)+)(/[^\s`|)]*)" % "|".join(METHODS))
    for match in pattern.finditer(text):
        methods = re.findall(r"|".join(METHODS), match.group(1))
        path = match.group(2)
        if not path.startswith(ROOT_PREFIXES):
            path = "/api" + path
        for method in methods:
            found.add((method, normalize(path)))
    return found


def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000/openapi.json"
    docs_path = sys.argv[2] if len(sys.argv) > 2 else "docs/api.md"
    live = live_routes(url)
    documented = documented_routes(open(docs_path).read())

    undocumented = live - documented
    stale = sorted(documented - live - RETIRED)

    new_drift = sorted(undocumented - UNDOCUMENTED_BASELINE)
    # An entry that is no longer undocumented has been written up; its line in the
    # baseline has to go, or the list stops describing anything.
    fixed = sorted(UNDOCUMENTED_BASELINE - undocumented)

    for method, path in new_drift:
        print(f"undocumented: {method} {path}")
    for method, path in stale:
        print(f"not live:     {method} {path}")
    for method, path in fixed:
        print(f"now documented (remove from UNDOCUMENTED_BASELINE): {method} {path}")

    print(
        f"\n{len(live)} live routes, {len(undocumented)} undocumented "
        f"({len(UNDOCUMENTED_BASELINE)} known), {len(stale)} stale"
    )
    return 1 if new_drift or stale or fixed else 0


if __name__ == "__main__":
    raise SystemExit(main())
