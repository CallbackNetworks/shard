# Structure: where work lives

Everything is a node, and two different relations connect them. Keeping them apart
is the single most useful idea in the product.

- **`contains`** — *where a node lives.* An organization contains an identity,
  which contains a project, which contains tasks. This is the relation every count
  and every progress bar rolls up through.
- **`owns`** — *whose it is.* An identity owns a container. It says nothing about
  where the work sits.

Folding the second into the first would make ownership read as one more level of
containment, which is why they stay separate axes.

![The structure map](/guide/09-structure-map.png)

The structure map draws that hierarchy four ways. Parenting resolves within what is
currently **visible**: if a filter hides a parent, its children are promoted to the
top rather than disappearing with it.

## How big is a project?

One definition, everywhere: **the top-level tasks in its whole `contains` subtree.**
The project page, search, the share page, the API, the emails and the assistant all
read the same number. If two screens ever disagree about a project's size, that is
a bug, not a difference of opinion.

## Item types

![Item types](/guide/16-item-types.png)

A node's *type* is data you can edit, not a fixed list in the code. A type declares
**roles** — `container`, `task`, `shareable` — and the roles are what the engine
reads. A custom type declaring the `task` role is a task everywhere: it appears in
search counts, analytics, reminders and the API, not just on the board.

A type also declares its **fields**: which keys in a node's data belong to you and
what widget each one gets. That is what the generic editor on a node's page draws.

![The node explorer](/guide/17-node-explorer.png)

The node explorer is the raw view — every node, every relation, no opinion about
what any of it means.
