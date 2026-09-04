# Automation, integrations and agents

## Rules

![Workflow rules](/guide/13-workflow-rules.png)

A rule is a trigger, some conditions and some actions. Triggers are **graph-shaped**,
not task-shaped: `node.created`, `node.updated`, `node.deleted`, `edge.added`,
`edge.removed` — so a rule can react to a relation being made, not only to a field
changing. The conditions can match *what changed*, not just the subject.

Rules never chain. Every write a rule makes goes back through the same pipeline with
rule triggering switched off, so a rule cannot set off a rule.

Before saving, the dry run shows what the rule would actually do against your real
data.

## Integrations

![Integrations](/guide/14-integrations.png)

Outbound: webhooks (signed with HMAC-SHA256) and email. Every attempt is logged with
retry backoff, because a webhook's failure mode is silence.

Inbound: a task gets a callback address that CI/CD posts to. GitHub, GitLab,
Jenkins, Drone and Bitbucket payloads are all recognised and normalised.

**Credentials never leave the server.** A stored secret reads back as `null` with its
key still present, and sending `null` means "unchanged" — so you can fetch a config,
edit one field and send it back without destroying a credential you were never shown.

## The assistant

![The assistant](/guide/12-assistant.png)

The assistant reads and writes your real data through a set of tools. The provider
is a runtime setting, not a build-time one: point it at Claude, at OpenAI, or at any
endpoint speaking either protocol, and the change takes effect on the next message.

## Agents and the API

Anything you can do in the browser, an agent can do through `/api/v1` with an API
key, or through MCP. That is a rule the codebase enforces with tests, not an
aspiration — a capability reachable only by a person in a browser is treated as a
defect.

![API keys](/guide/18-settings.png)

A key's **scope** bounds it: `read`, `write`, `admin`. A key can also be scoped to a
single container, which bounds it to that container's subtree.
