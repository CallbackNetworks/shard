# The data explorer and item types

This chapter is about the layer underneath everything else. You do not need it to
use Shard. You need it when you want Shard to hold something it did not come with.

## Everything is a node

A project, a task, a decision, an identity — underneath they are all the same
structure: a **node** with a **type**, and lines between nodes called **relations**.

"Project" is not a special class in the code. It is a type that has been given the
`container` role. "Task" is a type with the `task` role. That is the whole
difference, and it is why you can add your own.

## The data explorer

![The data explorer](/guide/17-node-explorer.png)

One page onto all of it.

**Left: the types.** Every type with how many exist. Those totals are counted on the
server, so the number beside a type is the real total rather than the number of rows
that happen to be on this page.

**Filter** below it is one list of ways to narrow what you are looking at, each row
with a count, so you can see what is there before you tick anything.

**Loose** has a specific meaning: nothing above it and nothing below it, on either
axis. Not filed anywhere, and holding or owning nothing. A top-level organization is
*not* loose even though nothing contains it — it holds work. This is the row for
things you made and forgot to put anywhere, and its count is the number worth
knowing: it is not the same as the relation count on the rows. Something owned by a
person but filed nowhere has a relation and is still lost.

The rows under it are the **states** the matching items are actually in — including
*(no status)*, which is a real state and usually the interesting one. That list is
counted from the data rather than fixed, so a type you invented shows whatever states
you have written into it. Tick as many as you like.

**Middle: search and results.** Type to match titles — or paste an item's id, which
is what the right-hand pane prints, so what the page shows you is something you can
hand back to it. The count line says which slice of the whole answer you are looking
at (*1–100 of 144*), counted on the server under every filter you have applied, and
*Previous* / *Next* move through it. Nothing is silently cut off.

Each row carries what the item *is*, not just its name: a status dot, where it lives,
how many relations it has, and when it last changed. **A relation count of zero is
red** — attached to nothing at all. That is the loudest case, not the whole of it: most
lost items have a relation and are still lost, which is what the *Loose* filter is for.

**Sort** sits beside the count. *Recently updated* is the default; the thing you just
made is at the top rather than at the end of the last page.

**Acting on many at once.** Tick the box on any row and a bar appears: file the whole
selection into one container with a single pick, or delete it. Each item is applied
separately and the result says how many went through and how many were refused — a
selection can hold different types, and different types have different legal parents.
This is what *Loose* is for: find the thirty things nobody filed, and file them.

Every item type can be created and deleted from here, built-in ones included. A task
or a project has a page of its own with much more on it, and you will usually want
that page — but here it is one row of data like any other, which is what makes the
loose-item cleanup possible.

**Right: the selected item.** Everything it is connected to, in both directions, and
the one control that adds a connection.

That picker only offers relations that will actually work. It asks the server the
same question the save does, and it offers both directions — so "this task belongs
to that project" and "this project contains that task" are both reachable, and you
cannot pick something that gets stored backwards without an error.

**The same panel is on every item's own page.** A project, a container, a persona and
any other item all carry it — collapsed, with the number of relations on the header,
so you can see at a glance whether anything is attached and open it when you want to
change that. This page is a good place to work through many items at once; it is no
longer the only place to connect one.

## Item types

![Item types](/guide/16-item-types.png)

The registry. This is where you add your own kind of item.

### Adding a type

Give it a key (`client`), a label ("Client"), a colour, and its **roles**:

| Role | Means |
|---|---|
| **container** | It can hold other things. Progress rolls up through it. |
| **task** | It *is* work. |
| **shareable** | It can have a public page. |

The roles are what the engine actually reads. A custom type with the `task` role is
a task **everywhere**: it appears in search counts, in analytics, in the due-date
reminders, in the daily email, in the API and to AI agents — not just on a board.

### Declaring fields

A type can declare which pieces of its data belong to you, and what kind of widget
each one gets: text, number, date, a URL, a yes/no.

Those declarations are what the editor on an item's page draws. Without them, data
you store on a custom item is visible but not editable in the interface.

### Relations

The lower half of the page lists the kinds of connection, and each one declares what
may sit at either end.

- **contains** — "lives inside". Every progress bar counts through this one.
- **owns** — "belongs to". Counts nothing.
- **depends_on** — "blocked until that is done".
- **supersedes**, **requires**, **conflicts_with**, **governs** — the decision
  relations, covered in the decisions chapter.

You can add your own relation and say what may sit at each end. Those rules are
enforced when something is saved, and the pickers elsewhere in the app are built
from them — so a relation you constrain here immediately shapes what the rest of the
app offers.

Built-in types and relations cannot be renamed or have their rules changed, because
other parts of the app depend on them meaning what they mean. Their colour and icon
are still yours.
