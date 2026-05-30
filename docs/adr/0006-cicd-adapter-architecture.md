# ADR-0006: CI/CD Adapter Architecture for Multi-Platform Webhook Support

## Status
Accepted

## Date
2026-05-30

## Context

The platform originally accepted only a simple `{"status": "done"}` format for inbound CI/CD webhook callbacks. This required every CI/CD pipeline to add a custom `curl` step to translate its native payload into the platform's format, creating friction for adoption and preventing the platform from capturing rich build metadata (commit SHA, branch, build duration, etc.).

Additionally, the outbound notification system had limited authentication options (Bearer token only) and no way to customize request headers per integration.

Key forces:
- Users work with diverse CI/CD tools (GitHub Actions, GitLab CI, Jenkins, Drone, Bitbucket, CircleCI)
- Each platform has its own webhook payload format and status terminology
- Rich build metadata is valuable for task context (build history, test results)
- Security: inbound webhooks had no signature verification
- Enterprise environments need flexible auth (Basic, API key, custom headers)

## Decision

We adopted a **provider adapter pattern** with auto-detection:

1. **`cicd_adapters.py`**: A pluggable adapter system that normalizes CI/CD payloads. Each provider (GitHub, GitLab, Jenkins, Drone, Bitbucket) has a dedicated parser function. The `detect_provider()` function examines HTTP headers and body shape to auto-select the right parser. A `generic` fallback handles the original simple format and any unknown providers.

2. **`WebhookEvent` model**: A new table stores enriched build metadata per inbound webhook call, creating a build history timeline per task. Fields include `provider`, `commit_sha`, `branch`, `build_url`, `build_duration_ms`, `triggered_by`, and `test_summary`.

3. **Inbound signature verification**: The webhook endpoint verifies `X-Hub-Signature-256` (GitHub HMAC), `X-Gitlab-Token` (GitLab), or `X-Signature` (generic HMAC) against a per-task `webhook_secret` field. If no secret is configured, all requests are accepted (backward compatible).

4. **Integration templates**: Predefined configurations for each CI/CD platform with auto-fill of type, events, auth method, and step-by-step setup instructions.

5. **Flexible outbound auth**: Integration model extended with `auth_type` (bearer/basic/api_key/none), `auth_config` (provider-specific settings), and `custom_headers` (arbitrary key-value pairs).

6. **Bidirectional sync**: New `/cicd/trigger/` endpoints allow triggering GitHub workflow_dispatch, GitLab pipeline triggers, Jenkins builds, and generic webhooks from the platform.

Alternatives considered:
- **Middleware/plugin system**: More extensible but over-engineered for the 5-6 CI/CD platforms we need. Adapter functions are simpler and easier to test.
- **Requiring users to configure provider per task**: Rejected because auto-detection from headers works reliably and reduces setup friction.
- **Storing raw payloads only**: Rejected because querying and displaying build history requires normalized fields.

## Consequences

**Positive:**
- Any CI/CD tool can now send its native payload — no `curl` wrapper needed for GitHub/GitLab/Jenkins/Drone/Bitbucket webhooks
- Build history provides rich context (commit, branch, duration, build URL) directly on each task
- Signature verification closes the security gap on inbound webhooks
- Templates dramatically reduce integration setup time
- Custom headers and multiple auth methods support enterprise environments

**Negative:**
- Each CI/CD platform's payload format is a maintenance surface (formats may change with platform updates)
- Auto-detection heuristics can misidentify unusual payloads (mitigated by `?provider=` query param override)
- `WebhookEvent` table grows with every inbound webhook — needs periodic cleanup for high-volume tasks
- Bidirectional trigger endpoints store API tokens in request bodies — not persisted, but users must handle token management
