# Settings, backups and shortcuts

![Settings](/guide/18-settings.png)

## Yours

Theme (light or dark), language, accent colour, date and time format, list density,
and which view a project opens in. These are stored on your account, so they follow
you to any machine you sign in on.

### Hiding menu rows

Turn off parts of the app you do not use, and drag the rest into the order you want.

Three rows cannot be hidden: **Overview**, **Guide** and **Settings**. Those are the
three you need to find your way back from a menu you have just trimmed too far.

## Your calendar

The **calendar feed** is a subscribe address covering everything with a due date.
Paste it into Google Calendar, Apple Calendar or Outlook and your deadlines appear
there, updating on their own.

Treat it as a credential: anyone holding the address can read it. It can be
regenerated, which stops the old one working.

## Scheduling

- **Summary hour** — when the daily summary email goes out (in UTC).
- **Due-soon window** — how far ahead of its due date a task triggers a reminder.
- **Reminder cooldown** — how long before the same task can remind you again.

Each of these has a range, and the range is served by the server from the same rule
the save enforces — so the page cannot offer you a value the save will quietly clamp.

The day of the week for the weekly digest is set in the server's configuration
rather than here.

## Backups

A backup runs automatically once a day and keeps the last few — you choose the hour
and how many to keep. You can also:

- **Run one now.**
- **Download one.** This is the whole database, including tokens and keys. Keep it
  somewhere safe.
- **Restore from one.** This replaces your current data, so it asks you to confirm
  by typing.

## The AI provider

Which model the assistant uses, covered in the assistant chapter. It takes effect on
the next message, with no restart.

## System status

Your version, database, and which optional features are switched on. This is the
block to quote in a bug report — the version reaches this page from the server, so
it names the build that actually answered rather than the code you think is
deployed.

## Keyboard shortcuts

| Key | Does |
|---|---|
| `?` | Show all shortcuts, and offer a tour of the current page |
| `Ctrl-K` / `Cmd-K` | Search everything |
| `/` | Jump to search |
| `C` | Create a task |
| `N` | Create a project |
| `G` then `H` | Home / Overview |
| `G` then `P` | Switch project |
| `G` then `A` | Analytics |
| `G` then `I` | Identities |
| `G` then `G` | Goals |
| `Esc` | Close whatever is open |

## Where to find help

![The guide](/guide/27-guide.png)

- **The compass button, bottom-left of every page.** It walks you through the page
  you are on, pointing at each control in turn. A dot on it means you have not taken
  that page's tour yet.
- **This guide**, in the menu. Its sidebar also lists every tour in one place with a
  tick beside the ones you have taken, so it works as a checklist on a first day.
- **`?`** for the shortcuts and a tour of wherever you are standing.

## Working offline

If your connection drops, the app keeps working. Changes you make are queued locally
and sent when you come back, in the order you made them. An indicator at the bottom
of the screen tells you that you are offline and how many changes are waiting.

Anything the server refuses when the queue drains is dropped rather than retried
forever, so a change that is no longer valid cannot wedge the queue behind it.
