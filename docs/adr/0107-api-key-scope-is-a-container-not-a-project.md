# ADR-0107: An API key's scope is a container, not just a project

## Status
Accepted

## Date
2026-08-21

## Context

`ApiKey.project_id` let a key be scoped to exactly one project, or left unrestricted
(`null`). That covers "give this agent access to one project" and "give it access to
everything", but nothing in between: a user with several projects grouped under one
identity (personal task manager, multi-identity by design — see ADR-0095) had no way to
scope a key to "everything under my work identity". The only options were one key per
project, or an unrestricted key that could also reach every other identity's projects.

Since ADR-0095, an identity carries the `container` role and can sit above projects via
`contains`, the same relation a project uses to hold its tasks. The access-control layer
(`routers/external_api/auth.py`) had not caught up: `_node_project_id` walked straight to
the nearest `project`-type ancestor, so it had no way to express "this key's scope is an
identity" even though the graph could already represent it.

## Decision

`ApiKey.project_id` is renamed to `container_id`. It may point at any node carrying the
`container` role — today that means a project or an identity — validated on write via
`graph.has_role(db, node.type, graph.ROLE_CONTAINER)` (422 otherwise). A key's scope is
everything the container's `contains` subtree reaches, computed with the existing
`graph.ancestors_of`/`descendants_of` walk rather than a new query: a project-scoped key
resolves to itself (unchanged behavior), an identity-scoped key resolves to every project
underneath it.

Two helpers in `auth.py` carry this everywhere a project id used to be compared or
defaulted: `_project_ids_in_scope(db, api_key)` returns the list of accessible project ids
(`None` for unrestricted), and `_resolve_project_scope(db, api_key, project_id)` validates
an explicit id against that scope or picks the single default when the scope is exactly one
project. A scope spanning more than one project has no safe single default — callers that
need one (e.g. `/analytics/velocity`) get a 400 asking for an explicit `project_id` rather
than a default that would either narrow silently or leak outside the key's scope.

Sweeping every `_check_project_access`/`api_key.project_id` call site (33 in the
project-scoped routers, plus another ~25 across analytics, search, summary, agent-context,
integrations, workflow-rules, task templates, activity and decisions) surfaced the same
latent gap in several places: `rule_admin.list_rules(db, project_id=project_id or
api_key.project_id)`-shaped code let an explicit query-param `project_id` silently
override — not just default past — a project-scoped key's own scope, because Python's `or`
put the caller-supplied value first. A project-scoped key could already read another
project's workflow rules, task templates, and decisions by passing `?project_id=<other>`.
Every one of those sites now validates the explicit id against scope before using it,
closing the gap as part of the same pass rather than generalizing it to identity scope too.

## Consequences

A user can hand an agent a key scoped to an entire identity without also handing over every
other identity's data, and without minting one key per project. The migration
(`7c28cd4fc24b`) is a plain column rename — existing project-scoped keys keep working
unchanged, since a project is a container too. `ApiKeys.jsx`'s scope picker now lists
projects and personas (identities) in one dropdown.

The cost is real: about a dozen router functions that used to compare a single id now
resolve a list, and a handful of endpoints (`/analytics/velocity`,
`/analytics/estimation-calibration`, `/analytics/estimate-suggestion`) will 400 for an
identity-scoped key spanning multiple projects unless `project_id` is passed explicitly —
there is no single project to default to, and returning platform-wide data instead would be
worse. This is bounded to project/task-shaped reads; nothing needed a service-layer
signature change to accept a list of project ids, because every multi-project case was
handled by post-filtering an already-fetched result in the router.
