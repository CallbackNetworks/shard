# Decisions

A decision record answers "why is this the way it is?" — the question that has no
home in a task list and gets asked months later by someone who was not in the room.

![The decisions room](/guide/10-decisions.png)

A decision is its own node type, so it carries its own relations:

- **`supersedes`** — this decision replaces that one. Recording it also retires the
  far end, because the edge and the status change are one act.
- **`governs`** — this decision decides that work. The direction is deliberate: a
  task is not *labelled with* a decision, a decision *decides* the task.
- **`requires`** — this holds only while that one does. Reading it backwards
  answers "what falls over if this premise is reopened?"
- **`conflicts_with`** — these two contradict each other. It is symmetric: writing
  it from either end is the same edge, and both ends report it.

A conflict is a question, not a verdict. Resolve it by superseding one side — never
by deleting either, which is why there is no "resolve" button.

## Filed where they live, drawn as a graph

Records are grouped by their ancestry, so an organization holding four projects is
one row rather than four. Large sections start collapsed.

The graph view is not a force layout — position is the answer to a directional
question. Column 0 is the foundations; following an arrow rightwards follows a
premise to its conclusion; governed work sits below. Selecting a node dims what it
does not touch, and the same card the list draws appears beside it, so noticing a
missing edge and adding it is one screen.

Relations are told apart by stroke pattern and glyph rather than colour, because
this page spends colour on status.
