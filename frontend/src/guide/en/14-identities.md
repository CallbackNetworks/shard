# Identities and focus

An identity is a hat you wear: "Work", "Freelance", "The band", a specific client.

![Identities](/guide/15-identities.png)

## Making one

Give it a name, a colour and a letter or emoji for its badge. Then file projects
under it.

An identity is a **real container**, not just a tag. That means:

- Projects filed under it roll their counts up into it.
- It can be shared as a whole — one public page covering everything inside it.
- It can receive CI/CD callbacks like any other container.
- Deleting it takes the tasks filed *directly* under it, but **not** the projects
  inside it — those survive.

## Focus: wearing one at a time

The switcher sits above the menu on the left.

Pick an identity and the whole app narrows to its work: the Overview, search
results, the project list, the command palette. Choose *no focus* to see everything
again.

This is one control with as many values as you have identities. That is why there is
not a menu row per identity — the menu's height should not grow every time you add
one.

Focus is not limited to identities, either. If you have built a layer above them —
an "organization" holding several identities — you can focus on that too, because
focus works on anything that can contain things.

## Owning versus containing

Two different lines, covered in the structure chapter but worth repeating here
because identities are where the difference shows up:

- An identity **contains** a project: the project lives inside it, and its progress
  rolls up.
- An identity **owns** a project: the project belongs to it, wherever it lives.

Most of the time you want `contains`. Use `owns` when something belongs to one
person or persona but sits somewhere else in the structure.
