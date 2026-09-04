# Labels, sprints, bulk edits and templates

The parts of a project that make it faster to run once there is real work in it.

## Labels

A label is a coloured tag: `bug`, `waiting-on-client`, `needs-review`. Manage the
list from the **Labels** button in a project's header, then apply them from a task's
edit row.

Labels are per project, so one project's `urgent` is not another project's. Filter
by one from the filter strip on any view.

## Cycles (sprints)

![The cycles tab](/guide/19-project-cycles.png)

A cycle is a named window of time — "Sprint 14", "October" — that tasks can belong
to. Open the **Cycles** tab in a project to create one with a start and end date,
then add tasks to it.

Two things become available once a project has cycles:

- **Burndown** on the Analytics page: how much work remains, day by day, against a
  straight line to zero. It tells you whether you are ahead or behind.
- **Velocity**: how much you actually finished in each past cycle. After three or
  four cycles this is a far better basis for planning than an estimate.

You can also **duplicate** a cycle, which copies its shape for the next round.

## Bulk edits

On the Issues tab, turn on selection mode from the filter strip. Checkboxes appear
on every row. Select several and a toolbar appears offering: set status, set
priority, pin.

This is the fastest way to close out a finished batch or to raise the priority of
everything a client just complained about.

## Import and export

**Export** writes the project's tasks to a JSON file. **Import** reads one back.
Together they are a round trip: you can export a project, edit the file, and import
it into another project.

The importer also reads exports from **Trello, Linear and GitHub**. It reports back
what it did — how many it imported, how many it skipped, and what went wrong with
each failure — rather than abandoning the whole batch because one row was odd.

## Templates

![Templates](/guide/21-templates.png)

A template is a task you keep re-creating, saved with its parts already filled in:
its subtasks, its labels, its default priority.

"Onboard a new client" might be a template with eight subtasks. "Cut a release"
might have five. Build it once on the Templates page, then apply it to any project
and it creates the task and all of its subtasks in one action.

Templates are shared across every project, so a template written while working on one
client is available for the next.
