# The API, API keys and AI agents

Everything you can do in the browser, a program can do too. That is a rule the
codebase enforces with tests: a capability reachable only by a person clicking is
treated as a defect, not as a design.

![API keys](/guide/24-api-keys.png)

## Making a key

**Settings → API keys → New.** Two decisions:

**What it may do.** Three scopes:

| Scope | Allows |
|---|---|
| `read` | Reading |
| `write` | Reading and changing |
| `admin` | Everything, including anything that hands over a credential |

**What it may reach.** A key can be left unscoped, or locked to a **single
container** — a project, or a whole identity. A container-scoped key can reach that
container and everything nested inside it, and nothing else.

The key is shown **once**, when it is created. Copy it then. If you lose it, delete
it and make another.

## Using it

Send it as an `X-API-Key` header against `/api/v1`. The page shows the address and a
worked example you can paste into a terminal.

The full endpoint list, with every parameter, is at `/docs` — that page is generated
from the code, so it cannot describe a version that no longer exists.

## What is available

Projects, tasks and every other node type; labels, cycles, dependencies,
attachments, recurrence, templates; search; the eight analytics reports; workflow
rules; integrations and their delivery logs; CI/CD configuration; share settings;
import and export; backups; and the item-type registry itself.

## MCP: connecting an AI agent

If you use an AI coding assistant that speaks **MCP** (the Model Context Protocol),
it can drive Shard directly. Around fifty tools are exposed, plus resources and
ready-made prompts.

Two ways to connect:

- **Locally**, as a process the assistant starts itself.
- **Remotely**, at the `/mcp` address on your instance, protected by a bearer token.

Both run the same code and both go through `/api/v1` with an API key — so the key's
scope is exactly what bounds what an agent can do, and there is no second permission
system to keep in step.

## Per-project agent instructions

Each project's **Agent** button gives you a block of text to paste into an assistant:
what the project is, its conventions, and how to reach it. You can add your own
instructions there, and there is a global set in the server configuration that
applies to everything.
