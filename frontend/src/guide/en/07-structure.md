# Structure: where work lives

This chapter explains the one idea that makes the rest of the app make sense. It is
short, and worth reading properly.

## Two different lines

Things are connected in two ways, and keeping them apart is the whole trick.

**`contains` — where something lives.**
An organization contains an identity, which contains a project, which contains
tasks. This is the nesting that progress bars and counts roll up through. If you
move a project into a different identity, that is a change to `contains`.

**`owns` — whose something is.**
An identity owns a project. That is a statement about responsibility, and it says
nothing about where the work sits.

They are kept as separate lines because folding them together would make "this is
mine" read as one more level of nesting. A project can live in one place and belong
to someone who is somewhere else.

## The structure map

![The structure map](/guide/09-structure-map.png)

The map draws the `contains` nesting. Four styles, same data:

- **Tree** nests children under their parents, indented.
- **Sankey** shows the same nesting as flowing bands, ordered depth-first.
- **Territory** draws each child *inside* its parent's card, so nesting is literal.
- **Network** is the free-floating web, with lines you can follow by eye.

Drag to pan, scroll to zoom, and use the buttons for zoom and fit. Click a box to
select it, double-click to open it.

**Filtering never loses work.** If a filter hides a box that had children, the
children move up to the top level rather than disappearing with their parent. You
can always trust that what is on the map is everything the filter matched.

## How big is a project?

There is one answer, and every screen uses it: **the top-level tasks anywhere in its
`contains` nesting.**

That single sentence is applied by the project page, search, the public share page,
the API, the summary emails and the assistant. If two screens ever disagree about
the size of a project, that is a bug rather than two reasonable readings.

Two consequences worth knowing:

- **Sub-projects count.** A project holding three sub-projects reports all of their
  tasks. Otherwise, inserting a level would make work vanish from the level above.
- **Subtasks do not double-count.** Breaking a task into five steps does not turn one
  task into six. Task *listings* still show them — they are real work — but the
  *size* number counts top-level tasks.
