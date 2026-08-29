/**
 * The decision graph: what rests on what, what contradicts what, what it decides.
 *
 * ADR-0128. The decisions page could only ever draw one relation — supersession — and
 * production holds two of those edges across 103 records, so a graph mode built before
 * ADR-0127 would have been 98 isolated dots. With `requires`, `conflicts_with` and a way
 * to create `governs` from the work's side, there is finally a shape to draw.
 *
 * Two bands, not a force layout. A force layout answers "is this clustered"; the four
 * questions this view exists for are directional — how the thinking got here, what it
 * rests on, what it contradicts, what it decides — and a layered picture answers those by
 * *position*, which a spring simulation actively destroys. Decisions occupy the top band,
 * laid out left to right by how much they rest on: column 0 is the foundations, and
 * following an arrow rightwards is following a premise up to its conclusion. Governed work
 * sits in the bottom band under the decisions that decide it.
 *
 * Unconnected records are excluded by default and *counted*, not hidden silently. A graph
 * is about relations; a record with none is a row, and the list mode is where rows live.
 */

// Relations this view draws. `superseded_by` / `required_by` are the same edges read from
// the other end, so following them too would draw every edge twice.
const OUTGOING = ['supersedes', 'requires', 'governs']

const NODE_W = 172
const NODE_H = 52
const WORK_W = 158
const WORK_H = 44
const COL_GAP = 76
const ROW_GAP = 14
const BAND_GAP = 96
const PAD = 28

/** Every relation that would put a decision on this canvas. */
export function decisionDegree(decision) {
  return (decision.supersedes || []).length
    + (decision.superseded_by || []).length
    + (decision.requires || []).length
    + (decision.required_by || []).length
    + (decision.conflicts_with || []).length
    + (decision.governs || []).length
}

/**
 * `{ nodes, links, unconnected, width, height }` for the decision graph.
 *
 * Resolution happens within the *visible* set — the same rule the structure map, the board
 * and the lineage rail follow (ADR-0069, ADR-0094, ADR-0118): a decision filtered off the
 * page cannot be an endpoint here, and its absence promotes rather than hides.
 */
export function buildDecisionGraph(decisions = [], { includeUnconnected = false } = {}) {
  const connected = decisions.filter(d => decisionDegree(d) > 0)
  const subjects = includeUnconnected ? decisions : connected

  // Only edges whose far end is also on screen; `governs` is the exception, because its
  // far end is work rather than a decision and is never in `decisions`.
  const subjectIds = new Set(subjects.map(d => d.id))
  const edges = []
  const seen = new Set()
  for (const d of subjects) {
    for (const rel of OUTGOING) {
      for (const ref of d[rel] || []) {
        if (rel !== 'governs' && !subjectIds.has(ref.id)) continue
        const key = `${rel}:${d.id}:${ref.id}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({ rel, from: d.id, to: ref.id, ref })
      }
    }
    // Symmetric, and the server already merged both directions into one list, so the
    // same conflict appears on both records. Keyed by the sorted pair so it is drawn
    // once — an undirected edge drawn twice is two arcs bowing opposite ways.
    for (const ref of d.conflicts_with || []) {
      if (!subjectIds.has(ref.id)) continue
      const [a, b] = [d.id, ref.id].sort()
      const key = `conflicts_with:${a}:${b}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ rel: 'conflicts_with', from: a, to: b, ref, symmetric: true })
    }
  }

  // Depth = how far this decision stands above what it rests on. `supersedes` and
  // `requires` both mean "that one is beneath this one", so they share the axis; a cycle
  // (impossible through the API, possible in hand-written data) stops at its own depth
  // rather than recursing forever.
  const depthCache = new Map()
  const beneath = new Map()
  for (const e of edges) {
    if (e.rel === 'supersedes' || e.rel === 'requires') {
      if (!beneath.has(e.from)) beneath.set(e.from, [])
      beneath.get(e.from).push(e.to)
    }
  }
  const depthOf = (id, guard = new Set()) => {
    if (depthCache.has(id)) return depthCache.get(id)
    if (guard.has(id)) return 0
    guard.add(id)
    const below = (beneath.get(id) || []).filter(x => subjectIds.has(x))
    const depth = below.length === 0 ? 0 : 1 + Math.max(...below.map(x => depthOf(x, guard)))
    guard.delete(id)
    depthCache.set(id, depth)
    return depth
  }

  const columns = new Map()
  for (const d of subjects) {
    const depth = depthOf(d.id)
    if (!columns.has(depth)) columns.set(depth, [])
    columns.get(depth).push(d)
  }
  // Same project together inside a column, then by name: the column decides *when*, the
  // order inside it should decide *whose*, so a reader's eye is not asked to track both.
  for (const rows of columns.values()) {
    rows.sort((a, b) => (a.project_id || '').localeCompare(b.project_id || '') || a.name.localeCompare(b.name))
  }

  const depths = [...columns.keys()].sort((a, b) => a - b)
  const tallest = Math.max(1, ...depths.map(d => columns.get(d).length))
  const bandHeight = tallest * NODE_H + (tallest - 1) * ROW_GAP

  const nodes = []
  depths.forEach((depth, col) => {
    const rows = columns.get(depth)
    const colHeight = rows.length * NODE_H + (rows.length - 1) * ROW_GAP
    const top = PAD + (bandHeight - colHeight) / 2
    rows.forEach((d, i) => {
      nodes.push({
        id: d.id,
        kind: 'decision',
        decision: d,
        name: d.name,
        status: d.decision_status || 'proposed',
        x: PAD + col * (NODE_W + COL_GAP),
        y: top + i * (NODE_H + ROW_GAP),
        w: NODE_W,
        h: NODE_H,
      })
    })
  })

  // The work band. A node governed by several decisions sits under their mean, which is
  // the honest position for it — it is not owned by whichever one happens to be first.
  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const workRefs = new Map()
  for (const e of edges) {
    if (e.rel !== 'governs') continue
    if (!workRefs.has(e.to)) workRefs.set(e.to, { ref: e.ref, from: [] })
    workRefs.get(e.to).from.push(e.from)
  }
  const workBandTop = PAD + bandHeight + BAND_GAP
  const placedWork = [...workRefs.entries()]
    .map(([id, { ref, from }]) => {
      const anchors = from.map(f => nodeById.get(f)).filter(Boolean)
      const cx = anchors.length
        ? anchors.reduce((sum, a) => sum + a.x + a.w / 2, 0) / anchors.length
        : PAD + WORK_W / 2
      return { id, ref, cx }
    })
    .sort((a, b) => a.cx - b.cx)

  // Spread anything that would overlap, left to right — a deterministic pass, not a
  // simulation, so the picture is the same on every render.
  let cursor = -Infinity
  for (const w of placedWork) {
    const x = Math.max(cursor, w.cx - WORK_W / 2)
    cursor = x + WORK_W + ROW_GAP
    nodes.push({
      id: w.id,
      kind: 'work',
      name: w.ref.title,
      type: w.ref.type,
      x,
      y: workBandTop,
      w: WORK_W,
      h: WORK_H,
    })
  }

  const finalById = new Map(nodes.map(n => [n.id, n]))
  const links = edges
    .filter(e => finalById.has(e.from) && finalById.has(e.to))
    .map(e => ({ ...e, source: finalById.get(e.from), target: finalById.get(e.to) }))

  const right = nodes.reduce((max, n) => Math.max(max, n.x + n.w), 0)
  const bottom = nodes.reduce((max, n) => Math.max(max, n.y + n.h), 0)
  return {
    nodes,
    links,
    unconnected: decisions.length - connected.length,
    width: right + PAD,
    height: bottom + PAD,
  }
}

/** A gentle arc between two node centres. Same shape the structure map's network view
 *  uses, so two graphs in one app do not draw an edge two different ways. */
export function decisionLinkPath(from, to) {
  const x1 = from.x + from.w / 2
  const y1 = from.y + from.h / 2
  const x2 = to.x + to.w / 2
  const y2 = to.y + to.h / 2
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const bow = Math.min(30, len * 0.14)
  const mx = (x1 + x2) / 2 + (-dy / len) * bow
  const my = (y1 + y2) / 2 + (dx / len) * bow
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`
}
