// Group projects by whose they are (ADR-0094).
//
// The dashboard drew 38 project cards as one flat wall. The graph knew all along which
// identity and which organization each of them sits under — that structure reached the
// screen only as the accent colour of a card, which is not a label anyone can read.
//
// The owner is the *nearest* thing above the project: the last step of its first
// containment trail, or, when nothing contains it, the identity that `owns` it. Those are
// two different relations on purpose (ADR-0078) and this is the one place that decides
// which of them names a group, so a card can never appear under two headings.

const UNGROUPED = '__ungrouped__'

export function ownerOf(entry) {
  const trail = entry?.trails?.[0]
  if (trail?.length) return trail[trail.length - 1]
  return entry?.owners?.[0] || null
}

export function groupProjectsByOwner(projects, ancestry) {
  const groups = new Map()
  for (const project of projects || []) {
    const entry = ancestry?.[project.id]
    const owner = ownerOf(entry)
    const key = owner?.id || UNGROUPED
    if (!groups.has(key)) {
      // Everything above the owner, for the heading: "CGCG › Pipeline developer".
      const trail = entry?.trails?.[0] || []
      groups.set(key, { key, owner, above: owner ? trail.slice(0, -1) : [], projects: [] })
    }
    groups.get(key).projects.push(project)
  }
  const list = [...groups.values()]
  // A project nobody claims is still work; it goes last rather than first so the
  // groups a user recognises stay at the top.
  return [
    ...list.filter(g => g.key !== UNGROUPED),
    ...list.filter(g => g.key === UNGROUPED),
  ]
}
