# ADR-0010: Gitea Support via GitHub-Compatible API Base Resolution

## Status
Accepted

## Date
2026-07-05

## Context
Outbound sync (closing an issue when a Shard task is completed) and CI/CD
workflow dispatch hard-coded `https://api.github.com` as the API host. This
worked for github.com but silently failed for self-hosted Gitea and GitHub
Enterprise (GHE) instances, even though those servers expose the same
`/repos/{owner}/{repo}/...` REST shape.

The inbound path complicates provider detection: Gitea sends GitHub-compatible
webhook headers (`X-GitHub-Event`), so Gitea-originated tasks are stored with
`external_provider = "github"`. We therefore cannot rely on the provider field
alone to know which host to call back — a "github" task may actually live on a
Gitea server. We needed a way to recover the correct API base at closure time
without adding mandatory new configuration for the common case.

## Decision
Introduce `resolve_github_api_base(external_url, integration_url)` and thread an
`api_base` parameter through `close_github_issue` and `trigger_github_workflow`.
Resolution priority:

1. `integration_url` when it already contains `/api/` — lets operators target
   GHE (`/api/v3`) or a custom mount explicitly.
2. The host of the issue's `external_url` (captured from the webhook payload):
   `github.com` → `https://api.github.com`; any other host →
   `{scheme}://{host}/api/v1` (Gitea's API mount).
3. Default to `https://api.github.com`.

Deriving the host from `external_url` means the common Gitea case needs zero new
configuration — the host is already present in every synced task. The GitHub
REST verbs, auth header (`Authorization: token <t>`), and request bodies are
identical across github.com, GHE, and Gitea, so only the base URL varies.

## Consequences
Positive: Gitea and GHE now work for outbound issue closure and workflow
dispatch with no schema change and no required config for Gitea. The resolver is
pure and unit-tested. GitLab keeps its existing separate path.

Negative: The `/api/v1` fallback assumes a Gitea-style mount; a non-Gitea,
non-GHE self-hosted server on a custom API path must set an explicit `/api/`
base URL on the integration. Provider detection still labels Gitea tasks as
"github", so the `external_provider` field is a compatibility family, not a
literal vendor — future code must not assume "github" means github.com.
