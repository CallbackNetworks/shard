# Visual Tour

A guided look at Shard — a personal, multi-identity task platform with a dark,
high-density "mission control" aesthetic. All screenshots use the default dark
theme and amber accent.

---

## Command Center

The home dashboard aggregates everything that needs attention: live stat cards,
a command hero, priority lanes (Critical / In Motion / Waiting / Done), agent
tasks, due-soon items, and a projects grid. A live activity ticker runs across
the top.

![Command Center](screenshots/01-command-center.png)

---

## Project Views

Every project can be viewed four ways, switchable from the tab bar. Issues,
labels, cycles, dependencies, WIP limits, and inline editing are shared across
all of them.

### Board (Kanban with WIP limits)
![Project board](screenshots/02-project-board.png)

### Gantt / Timeline
![Project timeline](screenshots/03-project-gantt.png)

### Calendar
![Project calendar](screenshots/04-project-calendar.png)

### Table
![Project table](screenshots/05-project-table.png)

---

## Analytics

Per-identity and per-project insight: totals, a year-long activity heatmap,
status trend lines, burn-down, and velocity.

![Analytics](screenshots/06-analytics.png)

---

## Activity Log

A filterable, real-time stream of every mutation across projects — grouped and
searchable, with signal filters by type.

![Activity log](screenshots/07-activity.png)

---

## Structure Map

A bird's-eye map of how identities, projects, and tasks relate.

![Structure map](screenshots/08-structure-map.png)

---

## Automation

### Workflow Rules
A trigger → condition → action rules engine (chainable up to depth 2).

![Workflow rules](screenshots/09-workflow-rules.png)

### Integrations
Outbound webhooks and email, with CI/CD provider auto-detection and delivery logs.

![Integrations](screenshots/10-integrations.png)

---

## AI Assistant

A built-in chat assistant with tool use (Claude / OpenAI / stub) — it can query,
create, and update tasks directly.

![AI assistant](screenshots/11-assistant.png)

---

## Identities

Manage separate personas (work, open source, freelance) with independent
projects, share pages, and analytics.

![Identities](screenshots/12-identities.png)

---

## Personalization

The Settings page exposes a wide set of user-adjustable preferences: theme,
accent color, interface scale, default project view and task priority, reduced
motion, date/time formatting, list density, live-refresh cadence, reminder
timing, and sidebar module visibility/order.

![Settings](screenshots/13-settings.png)

### Preferences in action

A few settings shown before / after — every change applies live.

**Timestamps — relative vs. absolute**

| Relative (default) | Absolute |
|---|---|
| ![Relative timestamps](screenshots/t1-timestamps-relative.png) | ![Absolute timestamps](screenshots/t2-timestamps-absolute.png) |

**List density — standard vs. full**

| Standard | Full |
|---|---|
| ![Standard density](screenshots/t3-density-standard.png) | ![Full density](screenshots/t4-density-full.png) |

**Week starts on — Sunday vs. Monday**

| Sunday | Monday |
|---|---|
| ![Week starts Sunday](screenshots/t5-week-start-sunday.png) | ![Week starts Monday](screenshots/t6-week-start-monday.png) |

**Accent color** — picking an accent swatch recolors the entire app (logo, stat
numbers, buttons, tickers), not just the Settings page. Interface scale and
reduced motion apply globally the same way.

---

## Adding a screenshot

Optimise it **before** the first commit — `oxipng -o4` or `pngquant` typically takes a
full-page capture from ~300KB to under 100KB with no visible loss.

This has to happen up front because git keeps every version of a blob forever:
recompressing an image that is already committed *grows* the repository rather than
shrinking it, since the original stays in the pack. The 20 images here total 4.1MB
and are deliberately left as they are for that reason — the saving is only available
on the way in.

Name the file for what it shows (`08-structure-map.png`), not whatever the capture
tool called it, and reference it from this page. An unreferenced screenshot is dead
weight nobody will dare delete later.
