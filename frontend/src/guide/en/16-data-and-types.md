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

**Loose only** is a filter with a specific meaning: nothing above it and nothing
below it. Not filed anywhere, and holding nothing. A top-level organization is *not*
loose even though nothing contains it — it holds work. This is the box for things
you made and forgot to put anywhere.

**Middle: search and results.** Type to match titles. The count line says how many
you are looking at out of the total, and *Load more* fetches the next page. Nothing
is silently cut off. Each row also shows where it lives, so the list is not a flat
bag of titles.

**Right: the selected item.** Everything it is connected to, in both directions, and
the one control that adds a connection.

That picker only offers relations that will actually work. It asks the server the
same question the save does, and it offers both directions — so "this task belongs
to that project" and "this project contains that task" are both reachable, and you
cannot pick something that gets stored backwards without an error.

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
