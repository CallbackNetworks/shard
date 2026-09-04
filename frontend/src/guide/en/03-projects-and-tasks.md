# Projects and tasks

A project holds work. This is the screen you will spend most of your time on.

![A project's issue list](/guide/03-project-issues.png)

## The header

- **The progress bar** counts every task in this project — including tasks inside
  sub-projects nested underneath it. If some of that work is not on the list below,
  a small line says how many. That is on purpose: the number should never be smaller
  than the work that actually exists.
- **Share** makes a public read-only page for this project. Chapter 15 covers it.
- **CI/CD** gives you a web address your build system can post to. Chapter 13.
- **Labels** manages the project's label vocabulary.
- **Agent** gives you the instructions to hand an AI agent so it can work here.
- **Archive** puts the project away without deleting it.
- **New issue** adds a task.

## Adding a task

Click *New issue*, or press `C` from anywhere in the app.

Only the title is required. Priority, due date, labels and who it is for can be
filled in now, or added later by clicking the task, or never filled in at all.

## A task row

Click the title and it becomes editable in place — no dialog, no separate page.

The small badges on the right of a row each open a panel underneath it:

| Badge | What it opens |
|---|---|
| Comment | A thread on this task |
| Link | **Dependencies** — what this task is waiting on, and what is waiting on it |
| Paperclip | **Attachments** — files, dragged in or picked |
| Clock | **Recurrence** — repeat this task every week, month, or on a schedule |
| Webhook | **Build history** — what your CI reported about this task |

### Subtasks

A task can have subtasks, and they appear indented under their parent.

They are counted as **real work everywhere** — the board draws them as their own
cards, the calendar places them on their own due dates, search finds them. A project
that plans everything under one parent task still shows you the ten real pieces
rather than a single card.

The one exception is the *size* of a project, which counts top-level tasks only. So
"this project has 12 tasks" does not become 60 because you broke each one into five
steps.

## Repeating work

Open a task's **recurrence** panel to make it repeat: every day, every week, every
month, or on a custom interval.

What actually happens is that Shard creates a **new copy** of the task on schedule,
carrying over its labels, its priority, its description and who it is assigned to.
The original stays where it is. This matters: your history keeps every occurrence
rather than a single row whose date keeps moving.

## Dependencies

In the dependencies panel, say that this task is **blocked by** another one.

A blocked task shows a marker in the list, and on the *Timeline* view the
relationship is drawn as a dashed connector between the two bars. Analytics uses the
same links to work out the critical path — the chain of tasks that decides when the
project can possibly finish.

## Attachments

Files land on the task, not in a general pile, and they are included in backups.
There is a size limit per file, which the page tells you if you exceed it.
