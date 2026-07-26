#!/usr/bin/env python3
"""Cross-check docs/api.md against the live OpenAPI spec, in both directions.

Usage: python3 scripts/check_api_docs.py [openapi-url]
Exits non-zero if any live route is undocumented, or any documented route is not live.
"""

import json
import re
import sys
import urllib.request

METHODS = ("GET", "POST", "PATCH", "PUT", "DELETE")
ROOT_PREFIXES = ("/api/v1", "/api/", "/webhook", "/share", "/ical", "/ws", "/health", "/docs", "/openapi", "/redoc")

# Routes named in prose only to say they were retired (ADR-0040 -> ADR-0043).
RETIRED = {
    ("POST", "/api/projects"),
    ("POST", "/api/projects/{}/tasks"),
    ("POST", "/api/projects/{}/labels"),
    ("POST", "/api/identities"),
}


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
    live = live_routes(url)
    documented = documented_routes(open("docs/api.md").read())

    undocumented = sorted(live - documented)
    stale = sorted(documented - live - RETIRED)

    for method, path in undocumented:
        print(f"undocumented: {method} {path}")
    for method, path in stale:
        print(f"not live:     {method} {path}")
    print(f"\n{len(live)} live routes, {len(undocumented)} undocumented, {len(stale)} stale")
    return 1 if undocumented or stale else 0


if __name__ == "__main__":
    raise SystemExit(main())
