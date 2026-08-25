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

# Routes that were already undocumented when this check was first wired into CI.
#
# A ratchet, not an exemption: the check fails if anything NOT in this set is
# undocumented, so new drift is refused from today. It also fails if an entry here
# becomes documented without being removed, so the list cannot quietly rot into a
# permanent excuse — documenting a route means deleting its line, and the number
# below only goes down.
#
# This existed because the checker was written and then wired to nothing: 99 of 320
# live routes had no entry in docs/api.md by the time anyone ran it.
UNDOCUMENTED_BASELINE = {
    ("DELETE", "/api/activity-watches/{}"),
    ("DELETE", "/api/v1/deliveries"),
    ("DELETE", "/api/v1/edge-types/{}"),
    ("DELETE", "/api/v1/integrations/{}"),
    ("DELETE", "/api/v1/notifications/{}"),
    ("DELETE", "/api/v1/projects/{}/tasks/{}/attachments/{}"),
    ("DELETE", "/api/v1/projects/{}/tasks/{}/recurrence"),
    ("DELETE", "/api/v1/templates/{}"),
    ("DELETE", "/api/v1/workflow-rules/{}"),
    ("GET", "/api/activity-watches"),
    ("GET", "/api/focus-targets"),
    ("GET", "/api/graph/ancestry"),
    ("GET", "/api/graph-types/data-keys/managed"),
    ("GET", "/api/nodes/{}/share-chat-log"),
    ("GET", "/api/nodes/{}/subtree"),
    ("GET", "/api/settings/bounds"),
    ("GET", "/api/v1/analytics/burndown"),
    ("GET", "/api/v1/analytics/critical-path/{}"),
    ("GET", "/api/v1/analytics/cycle-burndown"),
    ("GET", "/api/v1/analytics/estimate-suggestion"),
    ("GET", "/api/v1/analytics/estimation-calibration"),
    ("GET", "/api/v1/backup/download/{}"),
    ("GET", "/api/v1/backup/export"),
    ("GET", "/api/v1/backup/status"),
    ("GET", "/api/v1/decisions"),
    ("GET", "/api/v1/decisions/{}"),
    ("GET", "/api/v1/decisions/{}/export"),
    ("GET", "/api/v1/deliveries"),
    ("GET", "/api/v1/deliveries/{}"),
    ("GET", "/api/v1/edge-types/registry"),
    ("GET", "/api/v1/graph/ancestry"),
    ("GET", "/api/v1/integrations"),
    ("GET", "/api/v1/integrations/events"),
    ("GET", "/api/v1/integrations/{}/health"),
    ("GET", "/api/v1/integrations/sources"),
    ("GET", "/api/v1/integrations/templates"),
    ("GET", "/api/v1/integrations/templates/{}"),
    ("GET", "/api/v1/nodes/{}/share-chat-log"),
    ("GET", "/api/v1/nodes/{}/share-views"),
    ("GET", "/api/v1/nodes/{}/subtree"),
    ("GET", "/api/v1/nodes/{}/webhook"),
    ("GET", "/api/v1/nodes/{}/webhook-events"),
    ("GET", "/api/v1/projects/{}/cycles"),
    ("GET", "/api/v1/projects/{}/cycles/{}"),
    ("GET", "/api/v1/projects/{}/cycles/{}/compare"),
    ("GET", "/api/v1/projects/{}/tasks/{}/attachments"),
    ("GET", "/api/v1/projects/{}/tasks/{}/attachments/{}/download"),
    ("GET", "/api/v1/projects/{}/tasks/export"),
    ("GET", "/api/v1/projects/{}/tasks/{}/recurrence"),
    ("GET", "/api/v1/settings"),
    ("GET", "/api/v1/settings/bounds"),
    ("GET", "/api/v1/settings/ical-token"),
    ("GET", "/api/v1/tasks/unfiled"),
    ("GET", "/api/v1/templates"),
    ("GET", "/api/v1/workflow-rules"),
    ("GET", "/api/v1/workflow-rules/{}"),
    ("GET", "/api/v1/workflow-rules/vocabulary"),
    ("PATCH", "/api/v1/edge-types/{}"),
    ("PATCH", "/api/v1/integrations/{}"),
    ("PATCH", "/api/v1/projects/{}/tasks/{}/recurrence"),
    ("PATCH", "/api/v1/templates/{}"),
    ("PATCH", "/api/v1/workflow-rules/{}"),
    ("POST", "/api/activity-watches"),
    ("POST", "/api/api-keys/{}/rotate"),
    ("POST", "/api/nodes/{}/share/set-guest-notes"),
    ("POST", "/api/nodes/{}/webhook/rotate-token"),
    ("POST", "/api/v1/backup/restore"),
    ("POST", "/api/v1/backup/restore/{}"),
    ("POST", "/api/v1/backup/run"),
    ("POST", "/api/v1/cicd/trigger/generic"),
    ("POST", "/api/v1/cicd/trigger/github"),
    ("POST", "/api/v1/cicd/trigger/gitlab"),
    ("POST", "/api/v1/cicd/trigger/jenkins"),
    ("POST", "/api/v1/deliveries/{}/retry"),
    ("POST", "/api/v1/edge-types"),
    ("POST", "/api/v1/integrations"),
    ("POST", "/api/v1/integrations/{}/retry-all"),
    ("POST", "/api/v1/integrations/{}/test"),
    ("POST", "/api/v1/nodes/{}/share/set-guest-notes"),
    ("POST", "/api/v1/nodes/{}/webhook/rotate-secret"),
    ("POST", "/api/v1/nodes/{}/webhook/rotate-token"),
    ("POST", "/api/v1/notifications/mark-all-read"),
    ("POST", "/api/v1/projects/{}/cycles/{}/duplicate"),
    ("POST", "/api/v1/projects/{}/import/github"),
    ("POST", "/api/v1/projects/{}/import/linear"),
    ("POST", "/api/v1/projects/{}/import/trello"),
    ("POST", "/api/v1/projects/{}/tasks/{}/attachments"),
    ("POST", "/api/v1/projects/{}/tasks/{}/create-external-issue"),
    ("POST", "/api/v1/projects/{}/tasks/import"),
    ("POST", "/api/v1/projects/{}/tasks/{}/recurrence"),
    ("POST", "/api/v1/settings/ical-token/rotate"),
    ("POST", "/api/v1/tasks/{}/memberships/{}"),
    ("POST", "/api/v1/templates"),
    ("POST", "/api/v1/workflow-rules"),
    ("POST", "/api/v1/workflow-rules/{}/test"),
    ("POST", "/share/node/{}/chat"),
    ("PUT", "/api/settings/llm"),
    ("PUT", "/api/v1/settings/llm"),
    ("PUT", "/api/v1/settings/system"),
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
