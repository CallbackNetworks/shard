# Visual Tour

A guided look at Shard — a personal, multi-identity task platform with a dark,
high-density "mission control" aesthetic.

**These images are generated, not curated.** `scripts/screenshots.sh` drives the
running dev stack with Playwright and writes both this directory and
`frontend/public/guide/`, which is the copy the in-app guide (`/guide`) serves.
Two copies of one capture, because `frontend/Dockerfile.prod`'s build context is
`./frontend` — an image under `docs/` can never reach the SPA build (ADR-0148).

Regenerate after any change that alters a layout:

```bash
docker compose up          # the stack must be running
scripts/screenshots.sh
```

---

## Overview

The home screen collects everything asking for attention: stat cards, the command
hero, priority lanes (Critical / In Motion / Waiting / Done today), agent workload,
and a briefing of goals and open decisions.

Every number and every line on it is a way to reach the thing it names (ADR-0147).

![Overview](screenshots/01-overview.png)

Clicking a stat card narrows the task list to what that number counted. The
narrowing is named on the page and lives in the URL, so it survives a reload and can
be handed to someone else.

![Overview narrowed to overdue work](screenshots/02-overview-overdue.png)

---

## Project views

The same tasks, five ways. The view and the filters live in the URL, so a filtered
board can be bookmarked and shared.

### Issues
![Issue list](screenshots/03-project-issues.png)

### Board (kanban with WIP limits)
![Board](screenshots/04-project-board.png)

### Timeline (Gantt with dependencies)
Dashed connectors are `depends_on` edges; subtasks are indented under their parent
rather than hidden.

![Timeline](screenshots/05-project-timeline.png)

### Calendar
![Calendar](screenshots/06-project-calendar.png)

### Table
![Table](screenshots/07-project-table.png)

---

## Analytics

![Analytics](screenshots/08-analytics.png)

---

## Structure

The container hierarchy, drawn four ways from one forest. Parenting resolves within
the visible set: a filtered-out parent promotes its children rather than taking them
with it (ADR-0069).

![Structure map](screenshots/09-structure-map.png)

---

## Decisions

Decision records are their own node type with their own relations — `supersedes`,
`governs`, `requires`, `conflicts_with` — filed under the ancestry they live in
(ADR-0118, ADR-0126, ADR-0127, ADR-0128).

![Decisions](screenshots/10-decisions.png)

---

## Activity

![Activity](screenshots/11-activity.png)

---

## Assistant

Provider-agnostic and switchable at runtime: Claude, OpenAI, or any endpoint
speaking either protocol (ADR-0096, ADR-0097).

![Assistant](screenshots/12-assistant.png)

---

## Automation and integrations

![Workflow rules](screenshots/13-workflow-rules.png)
![Integrations](screenshots/14-integrations.png)

---

## Identities

![Identities](screenshots/15-identities.png)

---

## The graph itself

Node types are editable data, not a fixed list in the code. A type declares roles
and fields, and the roles are what the engine reads (ADR-0074, ADR-0119, ADR-0132).

![Item types](screenshots/16-item-types.png)
![Node explorer](screenshots/17-node-explorer.png)

---

## Settings

![Settings](screenshots/18-settings.png)
