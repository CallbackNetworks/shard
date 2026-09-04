# Integrations, webhooks and CI/CD

Two directions: telling something else what happened here, and letting something
else tell Shard what happened there.

## Outbound: telling other systems

![Integrations](/guide/14-integrations.png)

An integration sends a message out when something changes. Two kinds:

**Webhook** — an HTTP POST to a URL you give it. This is how you get messages into
Slack, Discord, or anything with an incoming-webhook address.

**Email** — an SMTP message. Email integrations also receive the daily summary and
the weekly digest.

For each one you choose which events it cares about (`task.created`,
`task.completed`, `task.overdue`, `project.complete`, and so on) and optionally which
project. Leave the project blank to hear about everything.

### Signing

Every outbound webhook is signed with HMAC-SHA256, in both an `X-Signature` and an
`X-Hub-Signature-256` header. The receiving end can verify the message really came
from your Shard and was not altered.

### Credentials never come back

A secret or token you enter here is stored and then **never sent back to the
browser**. It reads back as blank with its name still present.

That forces a rule you should know about: **blank on the way in means "leave it as
it was"**. So you can open a config, change one field and save, without wiping out a
credential you were never shown. To actually clear one, set it to an empty value
explicitly.

## The delivery log

![The delivery log](/guide/23-webhook-logs.png)

Every attempt is recorded: the event, where it went, the HTTP code that came back,
and how many attempts it took. Open a row for the exact request and response.

Failures are retried on a widening schedule — after 1 minute, then 5, 30, 120 and
360. After that the delivery is marked **dead**.

This log exists because **a webhook's failure mode is silence**. Nothing goes wrong
on your screen when a webhook stops arriving somewhere else, so it has to be written
down rather than assumed.

Passwords and tokens are blanked out here too — including in custom headers, which
are free-form and would otherwise be a second way for a credential to leave.

## Inbound: CI/CD reporting back

Open a project (or a task) and click **CI/CD**. You get a unique web address.

Point your build pipeline at it. When a build finishes, it posts there, and the task
picks up the result:

- The build is recorded in that task's history, always — success or failure.
- If the reported status maps onto a task status, the task is updated.
- If it does not map onto anything, the event is still logged and the task is left
  alone. An unrecognised status must not silently mean "done".
- When every task in a project reaches done, a `project.complete` event fires, which
  your outbound integrations will hear about.

**GitHub, GitLab, Jenkins, Drone and Bitbucket** are recognised automatically — the
shape of their payloads is detected from the request, so you do not have to
translate anything.

Callbacks must be signed. An unsigned callback is refused, rather than accepted with
a warning nobody reads.
