# Projects and tasks

A project holds work. Open one and the same tasks are drawn five ways — the view
you pick lives in the URL, so a filtered board can be bookmarked and shared.

## The issue list

![A project's issue list](/guide/03-project-issues.png)

Rows edit in place. The badges on a row each open a panel: comments, dependencies,
attachments, recurrence, build history. Subtasks nest under their parent and are
**counted as work everywhere** — a project that plans under one parent task still
shows you the ten real pieces.

## Board, timeline, calendar, table

![Board](/guide/04-project-board.png)

The board is a kanban with optional WIP limits per column. Drag a card to change
its status.

![Timeline](/guide/05-project-timeline.png)

The timeline draws dependencies as dashed connectors and lets you drag a bar to
change its dates.

![Calendar](/guide/06-project-calendar.png)
![Table](/guide/07-project-table.png)

The calendar places tasks on their due date; the table is the dense view for bulk
editing and sorting.

## Filters narrow the work, not the view

Whatever you filter to stays applied when you switch view. This is deliberate: a
filter that silently reset on every tab change is a filter you cannot trust. The
filter state is in the URL beside the view.

## Arriving from somewhere else

If you got here by clicking an entry on the Overview, the task you clicked is
scrolled to and highlighted. If a filter would have hidden it, the filter is
relaxed — you asked to see that specific task, and seeing it matters more than
keeping a narrowing you set earlier.
