# Decisions

A decision record answers "why is this the way it is?" — the question a task list
has no place for, and the one somebody asks six months later when everyone who was
in the room has forgotten.

![The decisions room](/guide/10-decisions.png)

## Writing one

Click *New decision*. Write what you chose and what you considered, then give it a
state:

| State | Means |
|---|---|
| **Proposed** | Still deciding. Waiting on you. |
| **Accepted** | This is how it is. |
| **Deprecated** | Still true on paper, do not build on it. |
| **Superseded** | Replaced by another decision, which is named. |

A decision lives inside a project, the same way a task does. It appears on the
project's public share page, so somebody reading about your work sees not just what
you did but why.

## Connecting decisions to each other

This is what makes a set of records useful rather than a folder of notes. Each
card's `⋯` menu offers four kinds of link:

**Supersedes** — this decision replaces that one. Recording it also marks the far
end as superseded, because the link and the state change are one act, and doing them
separately leaves you one failed click away from a dead end that claims to be live.

**Requires** — this only holds while that one does. Reading it backwards answers
"what falls over if we reopen this premise?", which is the question you actually
have when reconsidering something.

**Governs** — this decision decides that work. The direction is deliberate: a task
is not *labelled with* a decision; a decision *decides* the task. You can add this
link from either end — from the decision, or from the "governed by" strip on the
task or project itself.

**Conflicts with** — these two contradict each other. It is symmetric: write it from
either end and it is the same link, and both records report it.

A conflict is a question, not a verdict. Resolve it by superseding one side. There
is deliberately no "resolve" button, because deleting one side of a contradiction
destroys the evidence that it existed.

## The graph view

![The decision graph](/guide/22-decisions-graph.png)

Switch to *Graph* and the same records are drawn as a picture.

The layout is not a floating physics simulation — position means something. Column
zero is the foundations, following an arrow rightwards follows a premise to its
conclusion, and work a decision governs sits below it.

Click a node and everything it does not touch dims, and the same card the list draws
appears beside it. So noticing a missing link and adding it happens on one screen.

Records connected to nothing are excluded from the graph and **counted** — the page
says "99 with no relations — show" rather than quietly dropping them.

The kinds of line are told apart by their dash pattern and a small glyph rather than
by colour, because this page spends its colour on state. A conflict is drawn with no
arrowhead, because the claim points both ways.

## Filing

The list groups records by where they live, so an organization holding four projects
is one heading you can fold shut rather than four separate piles. Large sections
start collapsed, which matters once you have a hundred of them.
