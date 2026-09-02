# Shard

[![CI](https://github.com/CallbackNetworks/shard/actions/workflows/ci.yml/badge.svg)](https://github.com/CallbackNetworks/shard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/docker-callbacknetwork%2Fshard-blue)](https://hub.docker.com/r/callbacknetwork/shard-backend)

A personal multi-identity task management platform with CI/CD integration, AI agent
support, and bidirectional issue sync. Built for developers who manage work across
several roles, repositories and tools.

> **One instance, one person.** One shared password, no accounts, no tenants — the
> several *identities* are your own roles, not other users. Run your own instance;
> share a read-only page when somebody else needs to see something.

![Shard command center](docs/screenshots/01-command-center.png)

*New here? [**Concepts**](docs/concepts.md) explains the handful of words that make the
rest make sense. Every screen, annotated: [**Visual Tour**](docs/screenshots.md).*

## What it does

- **Work lives in a graph** — identities contain projects contain tasks, and any level
  can be shared, automated or reported on. Invent your own layer if none of those fit.
- **Issue sync, both ways** — an inbound webhook turns a GitHub or GitLab issue into a
  task; finishing the task closes the issue.
- **CI/CD reports in** — point a pipeline at a task's callback URL and its status
  follows your builds, with history per commit and branch.
- **Agents are first-class** — every capability has an API and an MCP tool, not just a
  screen. An assistant can plan, file and update work through the same code the UI uses.
- **Decisions are recorded and related** — one decision supersedes, requires or
  conflicts with another, and travels with the project's shared page.
- **Automation, analytics and notifications** — rules on graph changes, critical path
  and burn-down, signed webhooks and email digests.

Everything, in one list: [**docs/highlights.md**](docs/highlights.md).

## Install

```bash
git clone https://github.com/CallbackNetworks/shard.git && cd shard
docker compose -f docker-compose.selfhost.yml up -d
```

That is the whole install — it builds from source, so it needs no registry account and
no configuration. Open **http://127.0.0.1:8090/**.

To pull the images CI already built instead of building your own, and for everything
about running this beyond your own machine — reverse proxy, HTTPS, a real database,
backups — see [**docs/deployment.md**](docs/deployment.md).

Never used Docker? `scripts/setup.sh` checks what you need and walks you through it.

### Install it as an app

Shard is a PWA, so it does not need a desktop build to get a desktop window. In Chrome
or Edge, open your instance and click the **install icon** in the address bar (or
⋮ → *Cast, save and share* → *Install page as app*); in Safari, *File → Add to Dock*. You
get an icon, its own window, and offline caching of what you have already loaded.

Browsers only offer this over HTTPS or on localhost, so a plain-HTTP address on your
network will not show the install icon — put it behind a reverse proxy with a
certificate first ([docs/deployment.md](docs/deployment.md)).

### Upgrade

```bash
scripts/upgrade.sh
```

Pull, build, stop, **snapshot the database**, migrate, start — in that order, stopping
at the first failure. Do not upgrade with `docker compose up -d --build` on its own: it
starts new code against a database nothing migrated, and nothing tells you until a
request fails ([ADR-0136](docs/adr/0136-an-install-has-an-upgrade-path-and-a-version.md)).

## Configure

Everything is environment variables, and [`.env.example`](.env.example) documents every
one of them next to its default — copy it to `.env` and edit. The two that matter before
anyone else can reach your instance:

| Variable | |
|----------|--|
| `AUTH_PASSWORD` | Empty by default, which means **no login gate at all**. Set it before binding to anything but the loopback |
| `SECRET_KEY` | Signs share-PIN sessions. Unset means they reset on every restart |

Read [SECURITY](.github/SECURITY.md) before deploying beyond localhost.

## When something goes wrong

```bash
scripts/diagnose.sh > report.txt
```

Version, container status, schema revision, which settings are set (names only, never
values) and the last log lines — the answers to the first five questions of any bug
report. More in [docs/troubleshooting.md](docs/troubleshooting.md).

Verified on **Linux**, which is what CI installs from a clean tree on every push. It
should work on **macOS** (Docker Desktop) and **Windows** (WSL2) — nothing left depends
on host paths or user ids — but nobody has run it there yet. An issue saying it did or
did not is useful either way.

## Documentation

- [**Concepts**](docs/concepts.md) — what the words mean: nodes, roles, identities, containers, decisions
- [**Visual Tour**](docs/screenshots.md) — annotated screenshots of every screen
- [**Highlights**](docs/highlights.md) — the complete feature list, and what the notable ones do
- [Local setup](docs/local-setup.md) — development environment, page routes, tests
- [Deployment](docs/deployment.md) — self-hosting, upgrades, reverse proxy, backups
- [API reference](docs/api.md) · [Agent guide](docs/agent-guide.md) — the external API, MCP, subscriptions
- [Integrations](docs/integrations.md) — CI/CD webhook setup
- [Architecture](docs/architecture.md) — how it is built
- [Troubleshooting](docs/troubleshooting.md) · [Changelog](docs/CHANGELOG.md)
- [ADRs](docs/adr/) — 140 decisions, one per file, including the mistakes that shaped
  them. Written in a mix of English and Traditional Chinese

## Contributing

Issues and pull requests: **[github.com/CallbackNetworks/shard](https://github.com/CallbackNetworks/shard)**.

That repository is a **mirror** — development happens upstream and is pushed here, so a
pull request is applied upstream and appears on the next sync rather than being merged
on GitHub. [CONTRIBUTING](.github/CONTRIBUTING.md) explains that and the quality bar;
there is also a [Code of Conduct](.github/CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE).
