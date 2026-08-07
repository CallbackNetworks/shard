// The container hierarchy behind every structure-map style (ADR-0069).
//
// `contains` edges make containers nest to any depth, but the map used to draw
// one flat row of container cards: an inserted level became a sibling of the
// thing it contained. Each style asks this module the same two questions —
// "which containers are roots here" and "what hangs under this one" — so the
// four styles cannot disagree about the shape of the graph, only about how they
// draw it.
//
// Parenting is resolved *within the visible set*: filtering the map (search, a
// risk filter, identity focus) can hide a parent, and its children must then be
// drawn as roots rather than vanish with it.

const MAX_DEPTH = 24

export function buildContainerForest(containers = []) {
  const byId = new Map(containers.map(container => [container.id, container]))
  const childrenById = new Map()
  const parentById = new Map()
  const roots = []

  for (const container of containers) {
    const parentId = container.parentContainerId
    const parent = parentId && parentId !== container.id ? byId.get(parentId) : null
    if (!parent) {
      roots.push(container)
      continue
    }
    parentById.set(container.id, parent.id)
    if (!childrenById.has(parent.id)) childrenById.set(parent.id, [])
    childrenById.get(parent.id).push(container)
  }

  // A cycle would be rejected by the backend (`detect_cycle`), but a partial
  // slice must not be able to hang the renderer: anything not reachable from a
  // root is promoted to one, so every container is drawn exactly once.
  const seen = new Set()
  const walk = (container, depth) => {
    if (seen.has(container.id) || depth > MAX_DEPTH) return
    seen.add(container.id)
    for (const child of childrenById.get(container.id) || []) walk(child, depth + 1)
  }
  for (const root of roots) walk(root, 0)
  for (const container of containers) {
    if (seen.has(container.id)) continue
    parentById.delete(container.id)
    childrenById.delete(container.id)
    roots.push(container)
    walk(container, 0)
  }
  for (const [parentId, children] of childrenById) {
    childrenById.set(parentId, children.filter(child => parentById.get(child.id) === parentId))
  }

  const childrenOf = (id) => childrenById.get(id) || []
  const depthOf = (id) => {
    let depth = 0
    let cursor = parentById.get(id)
    while (cursor !== undefined && depth <= MAX_DEPTH) {
      depth += 1
      cursor = parentById.get(cursor)
    }
    return depth
  }

  return { roots, childrenOf, depthOf, parentOf: (id) => parentById.get(id) || null }
}

/** Roots first, each immediately followed by its subtree — the row order a columnar view needs. */
export function flattenContainerForest(forest, rootsSubset = null) {
  const out = []
  const visit = (container, depth) => {
    if (depth > MAX_DEPTH) return
    out.push({ container, depth })
    for (const child of forest.childrenOf(container.id)) visit(child, depth + 1)
  }
  for (const root of rootsSubset || forest.roots) visit(root, 0)
  return out
}
