# Concepts

Shard looks like a task manager and is shaped like a graph. That difference explains
most of what is unfamiliar about it, so it is worth five minutes before anything else.

If you only want to use it as a to-do list, you can: make a project, add tasks, done.
Everything below is what becomes available when you want more, and what the words in
the interface mean when you meet them.

## One instance, one person

There are no user accounts. An instance has a single optional password, and whoever
logs in sees and can change everything. The intended shape is that people run their own
instance rather than sharing one — sharing is done by publishing a read-only page for a
specific project or identity, not by inviting someone in.

So "multi-identity" does **not** mean multiple users. It means your own several roles.

## Everything is a node

A task, a project, an identity, a label, a decision: one table, one type field. That is
why the same features keep showing up in unexpected places — sharing, custom fields,
webhooks and activity history are properties of *nodes*, so anything can have them.

A node has a **type** (`task`, `project`, `identity`, …) and each type declares
**roles** that say how the engine treats it:

| Role | Meaning |
|------|---------|
| `container` | Things can live inside it, and it adds up what is inside |
| `task` | It is work: it has a status, a due date, and it counts as progress |
| `shareable` | It can be published as a public read-only page |

Roles are the reason a type you invent yourself is not second-class. Give your own
`repository` type the `container` role and it gets progress rollups, share pages and
CI/CD callbacks, because every feature asks about the role rather than the name.

## The two relations that matter

Nodes are joined by edges, and each kind of edge declares which types may sit at either
end. Two carry most of the meaning, and they are deliberately not the same thing:

- **`contains`** — *where something lives*. An organization contains an identity, which
  contains a project, which contains tasks. This is the one that adds up: a project's
  size is the tasks in its whole subtree.
- **`owns`** — *whose something is*. An identity owns a project. It says nothing about
  where the work sits or what it counts toward.

Keeping them apart is what lets you file work by structure and attribute it by person
without one answer contradicting the other.

Others you will meet: `depends_on` (this task is blocked until that one is done),
`in_cycle` (this task is in this sprint), and the decision relations below.

## Identity

An identity is one of your roles — day job, freelance, open source. It is a container,
so work lives inside it, and it can be published as a share page.

Its practical use is **focus**: pick an identity in the sidebar and the whole app
narrows to it. That is one control with several values, not several destinations, which
is why it is a switcher rather than a list of links.

## Container, project, goal

A **project** is the container you will use most, but it is not special — it is a type
with the `container` role. A **goal** is another. If neither fits, make your own type in
Settings → Graph Types: give it the `container` role and it behaves like a project
everywhere, including the analytics.

A container counts its **whole subtree**, not just its direct children. Put a project
inside another and the outer one's numbers include the inner one's work. Every screen
that reports a size asks the same function, so the dashboard, the search results and the
project page cannot disagree.

## Task

Work, with a status (`todo`, `in_progress`, `done`, `blocked`, `failed`), a priority, an
optional due date, and subtasks. Subtasks are tasks: they appear on the board, and they
carry their parent's name so you can tell where they came from.

"Overdue" means *past its due date and not done or failed* — one definition, used by
every screen and every email, because it used to have three and they disagreed.

## Decision

A decision record is a node type of its own, so it can be *related* to things:

- **`supersedes`** — this decision replaces that one, and marks it superseded.
- **`requires`** — this decision only holds while that one does.
- **`conflicts_with`** — these two contradict each other. This is a question, not a
  verdict: you resolve it by superseding one side, never by deleting either.
- **`governs`** — this decision decided that piece of work.

Decisions travel with a project's public share page, which is the point: someone reading
your shared plan can see why the work is shaped the way it is.

## Cycle, label, template

**Cycles** are sprints — a named time box you put tasks into. **Labels** are colour-coded
tags. **Templates** are reusable task structures, including subtasks and labels.

## Sharing

Any node with the `shareable` role can be published at a public URL: a read-only page,
optionally behind a PIN, optionally expiring. It carries the tasks, progress, cycles,
decisions, and a read-only assistant that can answer questions about *only* what the
page already shows. There is one share implementation for every type, so an identity
page and a project page behave identically.

A calendar feed (`.ics`) works the same way, and the whole instance has one too.

## Agents and the API

This is the part the design bends toward: anything you can do in the browser, an agent
can do through the API. There are three doors onto the same code —

- **`/api`** — what the web interface itself calls.
- **`/api/v1`** — the external API, authenticated with an API key scoped `read`,
  `write` or `admin`, and optionally limited to one container.
- **`/mcp`** — the same operations as MCP tools, for Claude and other MCP clients.

The rule is that no capability is browser-only. If a screen can do it, a key can too.

## Automation

**Workflow rules** watch for graph changes (`node.created`, `edge.added`, …) and act on
them. **CI/CD webhooks** let a build report into a task: point your pipeline at the
task's callback URL and its status follows your builds. **Notifications** go out as
signed webhooks or email, with retries.

## Where to go next

- [Visual tour](screenshots.md) — every screen, annotated
- [Highlights](highlights.md) — what each feature actually does
- [API reference](api.md) and the [agent guide](agent-guide.md)
- [ADRs](adr/) — why any of this is the way it is, one decision per file
