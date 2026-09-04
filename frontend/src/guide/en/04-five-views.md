# Five ways to see the same tasks

A project's tabs do not hold different data. They are five drawings of one set of
tasks, and switching between them changes nothing about the work.

## Issues — the list

![The issue list](/guide/03-project-issues.png)

The default. Rows edit in place, subtasks nest under their parents, and everything
about a task is reachable from its row.

Use it when you are working through things one at a time.

## Board — drag between columns

![The board](/guide/04-project-board.png)

Columns are statuses: to do, in progress, done, failed. Drag a card from one to
another and the task's status changes.

A column can carry a **WIP limit** — a maximum number of cards you want in it at
once. When a column is over its limit its header and count turn amber. It is a
nudge, not a lock: it will still let you drop the card. Limits are stored on the
project itself rather than set by clicking the column.

Use it when you want to see where everything is stuck.

## Timeline — dates and dependencies

![The timeline](/guide/05-project-timeline.png)

A Gantt chart. Each task is a bar between its start and its due date. Drag a bar to
move it; drag its edge to make it longer.

Dashed connectors between bars are dependencies. If A must finish before B starts,
you can see it here rather than reading it in a panel.

Use it when the question is "will this be done in time?"

## Calendar — by due date

![The calendar](/guide/06-project-calendar.png)

Each task sits on the day it is due. Tasks with no due date are not drawn at all,
which is itself useful information.

Use it when the question is "what does next week look like?"

## Table — dense and sortable

![The table](/guide/07-project-table.png)

Every field in columns. Click a heading to sort. This is the view for bulk work: turn
on selection mode and you can set the status or priority of twenty tasks at once, or
pin them.

Use it when you are tidying up rather than doing.

## Filters apply to all five

Whatever you filter to **stays applied when you switch tabs**. A filter that silently
reset every time you changed view would be a filter you could not trust.

You can filter by status, priority, label, who it is for, and when it is due, and
type into the search box to match titles.

The filter and the current tab both live in the web address. That means:

- Reloading the page keeps them.
- The browser's Back button undoes a filter change.
- You can bookmark "the board, high priority only, due this week".
- You can send that link to someone and they see exactly what you see.

One thing to know: the count in the filter strip matches the rows the view below
actually draws. The Issues list tucks subtasks under their parents while the other
views give each one its own row, so the number is different between tabs on purpose —
it is counting what is on your screen.
