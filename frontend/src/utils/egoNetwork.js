// The neighbourhood of one node, laid out.
//
// The structure map answers "how is the whole product shaped" and is built for the
// containment skeleton (ADR-0069). This answers the narrower question the Node
// Explorer was already asking — "what is attached to *this* node" — which it used to
// answer with a column of raw ids. It reads the `/graph/map` slice the page already
// holds, so it costs no extra request and works for any node type.
//
// Pure on purpose: layout is arithmetic, so it is tested without a DOM.

export const MAX_DEPTH = 2

const RING = [0, 150, 300] // radius per hop
export const NODE_R = [17, 11, 7] // circle radius per hop

const TAU = Math.PI * 2
const START = -Math.PI / 2 // first neighbour sits at the top

const empty = { nodes: [], links: [], truncated: false, viewBox: '0 0 0 0' }

function order(a, b) {
  return a.relType.localeCompare(b.relType) || (a.node.title || '').localeCompare(b.node.title || '')
}

/**
 * @param slice   `{nodes, edges}` from `GET /api/graph/map`
 * @param centerId the node the view is centred on
 * @returns positioned `nodes` (each with `depth`), `links` with endpoints resolved,
 *          and `truncated` when the cap cut neighbours off — a partial neighbourhood
 *          must say so rather than read as the whole one.
 */
export function buildEgoNetwork(slice, centerId, { depth = MAX_DEPTH, maxNodes = 80 } = {}) {
  const all = slice?.nodes || []
  const byId = new Map(all.map(n => [n.id, n]))
  const center = byId.get(centerId)
  if (!center) return empty

  const adj = new Map()
  for (const e of slice?.edges || []) {
    if (!byId.has(e.source_id) || !byId.has(e.target_id)) continue
    for (const [from, to, outgoing] of [[e.source_id, e.target_id, true], [e.target_id, e.source_id, false]]) {
      if (!adj.has(from)) adj.set(from, [])
      adj.get(from).push({ edge: e, other: to, outgoing })
    }
  }

  // Breadth-first so a node keeps the shortest hop count it was reached by, and
  // so the cap drops the far ring rather than an arbitrary slice of the near one.
  const placed = new Map([[centerId, { node: center, depth: 0, parent: null, relType: '' }]])
  const rings = [[centerId]]
  const linkIds = new Set()
  const links = []
  let truncated = false

  for (let d = 1; d <= depth; d++) {
    const next = []
    for (const parentId of rings[d - 1]) {
      for (const { edge, other, outgoing } of adj.get(parentId) || []) {
        if (!placed.has(other)) {
          if (placed.size >= maxNodes) { truncated = true; continue }
          placed.set(other, { node: byId.get(other), depth: d, parent: parentId, relType: edge.rel_type })
          next.push(other)
        }
        if (!linkIds.has(edge.id) && placed.has(other)) {
          linkIds.add(edge.id)
          links.push({ id: edge.id, relType: edge.rel_type, sourceId: edge.source_id, targetId: edge.target_id, outgoing, hop: d })
        }
      }
    }
    rings.push(next)
  }

  // Angles: each first-ring node gets a slice of the circle sized by how many
  // children it brings, and sits at that slice's centre with its children inside it.
  // Even slices are what crowded a hub — one neighbour holding fifteen of the second
  // ring got the same wedge as one holding none, and its children overlapped into an
  // unreadable clump while the rest of the circle stood empty.
  const childrenOf = new Map()
  for (const id of rings[2] || []) {
    const entry = placed.get(id)
    if (!childrenOf.has(entry.parent)) childrenOf.set(entry.parent, [])
    childrenOf.get(entry.parent).push(entry)
  }

  const angle = new Map([[centerId, 0]])
  const first = rings[1].map(id => placed.get(id)).sort(order)
  const weightOf = (entry) => Math.max(1, (childrenOf.get(entry.node.id) || []).length)
  const total = first.reduce((sum, entry) => sum + weightOf(entry), 0) || 1
  let cursor = 0
  for (const entry of first) {
    const w = weightOf(entry)
    const from = START + TAU * (cursor / total)
    const to = START + TAU * ((cursor + w) / total)
    cursor += w
    angle.set(entry.node.id, (from + to) / 2)

    const kids = (childrenOf.get(entry.node.id) || []).sort(order)
    // A margin keeps two neighbouring slices' children from meeting at the seam.
    const inset = (to - from) * 0.12
    kids.forEach((kid, i) => {
      const t = kids.length === 1 ? 0.5 : i / (kids.length - 1)
      angle.set(kid.node.id, from + inset + (to - from - inset * 2) * t)
    })
  }

  const laid = [...placed.values()].map(({ node, depth: d, relType }) => {
    const a = angle.get(node.id) ?? 0
    return {
      ...node,
      depth: d,
      relType,
      r: NODE_R[d] ?? NODE_R[NODE_R.length - 1],
      x: Math.round(Math.cos(a) * (RING[d] ?? RING[RING.length - 1]) * 100) / 100,
      y: Math.round(Math.sin(a) * (RING[d] ?? RING[RING.length - 1]) * 100) / 100,
    }
  })
  const pos = new Map(laid.map(n => [n.id, n]))

  const drawn = links
    .filter(l => pos.has(l.sourceId) && pos.has(l.targetId))
    .map(l => ({
      ...l,
      x1: pos.get(l.sourceId).x, y1: pos.get(l.sourceId).y,
      x2: pos.get(l.targetId).x, y2: pos.get(l.targetId).y,
    }))

  const xs = laid.map(n => n.x)
  const ys = laid.map(n => n.y)
  const minX = Math.min(...xs) - 90
  const minY = Math.min(...ys) - 30
  const width = Math.max(...xs) + 90 - minX
  const height = Math.max(...ys) + 34 - minY

  return {
    nodes: laid,
    links: drawn,
    truncated,
    width,
    height,
    viewBox: `${minX} ${minY} ${width} ${height}`,
  }
}
