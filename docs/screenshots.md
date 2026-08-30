# Visual Tour

A guided look at Shard — a personal, multi-identity task platform with a dark,
high-density "mission control" aesthetic. All screenshots use the default dark
theme and amber accent, with the navigation rail expanded.

---

## Command Center

The home dashboard aggregates everything that needs attention: live stat cards,
a command hero, priority lanes (Critical / In Motion / Waiting / Done today),
agent workload, and a briefing panel of goals and open decisions. A live
activity ticker runs across the top and a signal timeline along the bottom.

![Command Center](screenshots/01-command-center.png)

---

## Project Views

Every project can be viewed five ways, switchable from the tab bar. Issues,
cycles, dependencies, WIP limits, owners and inline editing are shared across
all of them, and the view you pick lives in the URL, so a filtered board can be
bookmarked and handed to someone else.

### Board (Kanban with WIP limits)
![Project board](screenshots/02-project-board.png)

### Timeline (Gantt with dependencies)
Bars are drag-resizable; dashed connectors are `depends_on` edges, and subtasks
are indented under their parent instead of being hidden.

![Project timeline](screenshots/03-project-gantt.png)

### Calendar
![Project calendar](screenshots/04-project-calendar.png)

### Table
![Project table](screenshots/05-project-table.png)

---

## Decision Room

Decisions are a first-class node type, not a tag — they carry their own
relations, so the record can say what it replaces, what it rests on, what it
contradicts, and which work it governs.

The list files every record under the container it actually lives in, with
lineage chains drawn as connected cards and a pending-review queue grouped by
project, identity, area or goal.

![Decision room](screenshots/14-decisions.png)

The graph mode is a deterministic left-to-right layout, not a force simulation:
column 0 holds the foundations, following an arrow rightwards follows a premise
to its conclusion, and the work a decision governs sits below it. Relations are
told apart by stroke and glyph rather than colour, because colour is spent on
status here.

![Decision graph](screenshots/15-decision-graph.png)

---

## Hierarchy

A bird's-eye map of how personas, projects, tasks, goals and decisions relate.
Four layouts (territory, sankey, tree, network) all read the same container
forest, so an extra level inserted anywhere shows up in each of them.

![Hierarchy map](screenshots/08-structure-map.png)

---

## Analytics

Totals, a year-long activity heatmap, status trend lines, burn-down, velocity
and estimate calibration — filterable per project and per time window, with CSV
export on each panel.

![Analytics](screenshots/06-analytics.png)

---

## Activity Log

A filterable, real-time stream of every mutation across projects — log,
timeline and wall renderings, with signal filters by type.

![Activity log](screenshots/07-activity.png)

---

## Automation

### Workflow Rules
A trigger → condition → action rules engine. Triggers are graph-shaped
(`node.created`, `node.updated`, `edge.added`, …), each rule reports what it
actually did — including the runs it deliberately skipped — and any rule can be
dry-run against a real task before it is switched on.

![Workflow rules](screenshots/09-workflow-rules.png)

### Integrations
Outbound webhooks and email, with CI/CD provider auto-detection, HMAC-signed
deliveries, per-integration success rate and a delivery log.

![Integrations](screenshots/10-integrations.png)

---

## AI Assistant

A built-in chat assistant with tool use (Claude, OpenAI, or any endpoint
speaking either wire protocol). It queries and mutates the same data the UI
does; each tool call is shown inline and can be expanded to its raw result.

![AI assistant](screenshots/11-assistant.png)

---

## Personas

Manage separate identities (work, open source, freelance) with independent
projects, share pages and analytics. Any persona can also be focused from the
rail, which narrows every surface to that persona's work.

![Personas](screenshots/12-identities.png)

---

## The graph underneath

Projects, tasks, identities, cycles and decisions are all nodes of a typed
graph, and the app exposes that directly rather than hiding it.

### Any node has a page
Fields declared by the node's own type, the containers it lives in, the
relations it holds, and the decisions that govern it.

![Node page](screenshots/16-node-page.png)

### Types are data, not code
Node types and edge types are editable at runtime: roles decide behaviour
(`container`, `task`, `shareable`, `calendar`), declared fields decide what the
generic editor draws, and an edge type declares what may sit at each end.
Built-in declarations are frozen; anything you add is yours.

![Node and edge types](screenshots/17-item-types.png)

### Data explorer
Browse the raw graph — filter by type, follow edges from either end, and open
any node.

![Data explorer](screenshots/18-node-explorer.png)

---

## Public Share Page

Any shareable container gets a read-only public page: progress, tasks, cycles,
comments, an iCal feed, optional guest notes, an optional PIN and expiry — plus
the decisions behind the work, so a reader who was not in the room can see why
it is shaped this way.

![Public share page](screenshots/19-share-page.png)

---

## Personalization

The Settings page exposes a wide set of user-adjustable preferences: theme,
accent color, display font, interface scale, default project view and task
priority, reduced motion, date/time formatting, list density, live-refresh
cadence, rail expansion, and sidebar module visibility/order.

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

Optimise it **before** the first commit — `pngquant` (48 colours is enough for
this UI) followed by `oxipng -o4` typically takes a full-page capture from
~800KB to under 300KB with no visible loss.

This has to happen up front because git keeps every version of a blob forever:
recompressing an image that is already committed *grows* the repository rather
than shrinking it, since the original stays in the pack. The saving is only
available on the way in.

Capture with the rail expanded and reduced motion on — the pages animate their
headings on mount, and a capture taken too early catches the animation instead
of the page. Wait for content the page only has once loaded, not for a fixed
number of seconds.

Name the file for what it shows (`08-structure-map.png`), not whatever the
capture tool called it, and reference it from this page. An unreferenced
screenshot is dead weight nobody will dare delete later.
