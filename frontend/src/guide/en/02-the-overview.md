# The Overview

The home screen collects everything asking for your attention. The important thing
to know about it: **it is not a report you read and leave. Every number and every
line on it is a way to reach the thing it names.**

![The Overview](/guide/01-overview.png)

## The cards at the top

Overdue, In progress, Done this week, and so on. Each one is a question, and
clicking it answers the question with the actual work rather than a chart.

![The Overview narrowed to overdue work](/guide/02-overview-overdue.png)

Click *Overdue* and the list below shrinks to exactly those tasks. The page says so
in a strip that also offers the way back out.

That narrowing lives in the web address. So it survives a page reload, the browser's
Back button undoes it, and you can send the link to someone else and they will see
the same filtered view.

### What "overdue" means

Past its due date, and not finished and not failed. That is the definition
everywhere in the app — the Overview, Analytics, the emails, the API all use it. A
failed task is not late; it is failed, and it is counted under failed instead.

## The lanes

Four groups of actual tasks:

- **Critical** — overdue or high priority. Start here.
- **In Motion** — someone has started it.
- **Waiting** — nobody has picked it up.
- **Done today** — what you finished, so the day has a visible bottom line.

Click any task and it opens **inside its project**, with that row scrolled to and
briefly highlighted. If a filter on the project page would have hidden it, the
filter relaxes — you asked to see that specific task, and seeing it matters more
than a narrowing you set an hour ago.

## The live feed

Down the right-hand side: everything that has happened recently. A task finished, a
build reported back from your CI, a rule that fired. Every line links to the thing
it names.

Below it sit your open goals and any decisions still marked "proposed" — the two
things that quietly stall if nobody looks at them.

## Rearranging it

Each block on this page is a widget you can hide in **Settings**. If you never use
goals, turn that block off and the page gets shorter. Nothing is lost — the Goals
page is still in the menu.

## The rail down the left

The menu is grouped by what you are doing:

| Group | What is in it |
|---|---|
| **Operate** | What is happening now: the Overview, the structure map, activity, analytics |
| **Think** | Goals, decisions, templates, the assistant |
| **Build** | Integrations, automation rules, delivery logs, API keys |
| **Data** | The raw graph: the data explorer and item types |
| **System** | Identities, this guide, settings |

Two things are deliberately **not** in the menu.

**Which project you want** is a choice, not a fixed destination — so it lives in the
palette (`G` then `P`) rather than as a permanent row per project.

**Identity focus** is one control with as many values as you have identities, so it
sits in its own slot above the menu rather than adding a row each time you make one.
The menu's height should not be a function of how much data you have put in.
