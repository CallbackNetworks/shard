# Sharing work with people outside

A share link gives somebody a read-only web page for a project or an identity.
They do not need an account, and they cannot change anything.

![A shared project page](/guide/25-share-page.png)

## Turning it on

Click **Share** in a project's header (or the settings button on an identity). One
panel holds everything:

| Control | What it does |
|---|---|
| **Link** | The public address. Copy and send it. |
| **Rotate** | Issues a new address. The old one stops working immediately. |
| **PIN** | A code the visitor must enter before seeing anything. |
| **Expires** | A date after which the link stops working. |
| **Guest notes** | Lets visitors leave a note without an account. |
| **Views** | How many times the page has been opened. |
| **Calendar feed** | A subscribe address for the due dates, for Google/Apple Calendar. |

## What the visitor sees

The tasks, their statuses and due dates, labels, cycles, comments, dependencies —
and **the project's decision records**, with their supersession chains and the work
they govern.

Decisions are on the public page for a reason. The one person most likely to ask
"why is it like this?" is the person who was not in the room, and that is exactly
who this page is for.

There is also a **structure graph**: the same map the Structure page draws for you,
built from what the link already carries. What holds what, which task is waiting on
which, and which decision governs which task — the relations the rest of the page
states in words, one end at a time. Select a node and everything it does not touch
dims. Three layouts, and the zoom controls are there because a big project starts out
fitted to the frame.

At the top, under the summary, the **Analytics** section opens on a **terrain map**:
the whole share is one mountain range, and every project is a summit in it, joined to
its neighbours by ridges. A summit's width is all of its tasks, its height the tasks
still open, and its lines are brighter the busier the last 30 days were; the dim
foothills between them belong to no project. Where it stands is a
reading, not decoration — left to right is how long since the project last changed
(90 days or more at the far left, today at the right), back to front is how much of it
is done. So a mountain at the front right is recent and nearly finished, and one at
the back left is untouched. Tasks are small squares on the slopes; point at one, or at
a summit, to see what it is. **Map** draws it as contour lines from above; **3D** draws
the same terrain in perspective from nearly overhead. Drag it to move around, use the wheel (or pinch, on a
phone) to zoom in on a crowded corner, and shift-drag to turn and tilt it; double-click
puts it back;
**Timeline** shows when each project was busy. Past eight projects the smallest fold
into one low range labelled with how many it holds.

Below it are the analytics page's own charts — the year's activity, the status trend,
a sprint's burndown, velocity — each shown only when it has something to show: a
burndown that never moved is left out rather than drawn as a flat line.

The bar across the top scrolls the latest things people did on the work; what the
system did on its own (rules firing, reminders, page views) stays out of it.

There is also a read-only assistant on the page, docked in the bottom-right corner
(the **Ask** button in the section nav raises it too). It can answer questions about
the project, and it can only see what the page already shows. It cannot create
anything.

## Practical notes

- **Rotating breaks the old link.** The calendar feed built on it stops resolving
  too. That is the point of rotate — use it when a link has gone somewhere it
  should not have.
- **The PIN applies to everything on the page**, including leaving a guest note. It
  is not a way around the gate.
- **The link is the credential.** Anyone holding it can read the page, so treat it
  the way you would treat a password, and use the PIN and the expiry date when it is
  going somewhere you do not control.
