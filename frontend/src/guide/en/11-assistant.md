# The assistant

A chat window that can read and change your real data.

![The assistant](/guide/12-assistant.png)

## What it can actually do

It is not a search box with a friendly voice. It has a set of tools and it uses
them:

- Summarise where things stand
- List and filter tasks
- **Create** tasks and subtasks
- **Update** tasks — status, priority, dates, assignment
- Add and remove labels
- Analyse your workload and tell you where it is concentrated
- Search everything
- Read the activity history

So "make a task to renew the domain before the 30th, high priority" produces a task.
"What is overdue in the client work?" produces a list of your actual tasks.

## Two places, one assistant

There is a full page in the menu, and a floating panel available from any screen.
They are the same thing — same conversations, same abilities, same suggested
prompts. The panel hides itself when you are already on the page.

## Conversations are kept

Every chat is saved and searchable, so what the assistant told you last week is
still there. The `+` button starts a fresh one.

## Choosing which AI it uses

Go to **Settings → AI provider**. Choose the provider, paste an API key, name a
model.

This takes effect on your **next message**. There is no restart and no redeploy.

Two things worth knowing:

- **The "provider" is a protocol, not a company.** It means "this endpoint speaks
  the Anthropic API shape" or "this one speaks the OpenAI API shape". The optional
  base URL field lets you point either one at something else — a gateway, a proxy,
  or your own compatible server.
- **The model name is checked, gently.** When you save one, Shard asks the provider
  whether that model exists. If it cannot tell — no network, an endpoint that does
  not list models — it saves anyway and says "unverified" rather than refusing.

If no provider is configured, the assistant says so instead of pretending to answer.

## On the public share page

A project's public page has its own read-only assistant. It can answer questions
about the project, and it can only see **what the page already shows**. It cannot
create anything and it cannot read past what a visitor could read by scrolling.
