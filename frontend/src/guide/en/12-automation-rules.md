# Automation rules

If this happens, do that. Rules run on the server, so they work whether or not you
have the app open.

![Workflow rules](/guide/13-workflow-rules.png)

## The three parts

**A trigger** — what to watch for:

| Trigger | Fires when |
|---|---|
| `node.created` | Anything is created — a task, a project, a decision |
| `node.updated` | Anything changes |
| `node.deleted` | Anything is deleted |
| `edge.added` | Two things are connected |
| `edge.removed` | A connection is removed |

Notice these are about *things in general*, not about tasks specifically. A rule can
react to a project being filed under an identity, or to a decision being linked to
the work it governs — not only to a field on a task changing.

**Conditions** — which of those events you care about. You can match on the thing
itself (its type, status, priority, labels, title), and also on **what changed**:
which field moved, which kind of connection was made, and which end of it your thing
was on. So "when a task is moved into a project" is expressible, and so is "when a
task's priority specifically is raised".

**Actions** — what to do: change a status or a priority, add or remove a label,
assign it, send a notification.

## The dry run

Before you save, run it. The dry run evaluates the rule against your **real current
data** and reports what it would have done.

This is worth using every time. It is easy to write a condition that matches
everything or nothing, and both look identical until something happens.

## Reading the counters

Each rule shows two numbers: how many times it ran, and how many times it actually
changed something.

**When those are far apart, look at the rule.** A rule that fires constantly and
changes nothing looks exactly like a rule that works — same green state, same growing
count — and the second number is the only thing that tells them apart.

## Rules do not chain

A change made by a rule does not trigger other rules. This is deliberate: chained
rules produce loops that are very hard to see in a list of individually sensible
rules, and the loop is discovered as a runaway rather than as a mistake.

## Where else rules can be managed

Everything on this page is also available through the API and to AI agents. A rule
can be created, edited, run and deleted by a script — which matters, because an
agent that can do every action forever but cannot automate one is only half useful.
