const STATUSES = ['proposed', 'accepted', 'deprecated', 'superseded']

export function decisionStatus(decision) {
  return decision?.decision_status || 'proposed'
}

export function deriveDecisionRoom(decisions = []) {
  const byStatus = Object.fromEntries(STATUSES.map(status => [status, []]))
  const other = []

  for (const decision of decisions) {
    const status = decisionStatus(decision)
    if (byStatus[status]) byStatus[status].push(decision)
    else other.push(decision)
  }

  return {
    byStatus,
    other,
    queue: byStatus.proposed,
    outcomes: [
      ...byStatus.accepted,
      ...byStatus.superseded,
      ...byStatus.deprecated,
      ...other,
    ],
    counts: {
      total: decisions.length,
      proposed: byStatus.proposed.length,
      accepted: byStatus.accepted.length,
      deprecated: byStatus.deprecated.length,
      superseded: byStatus.superseded.length,
      other: other.length,
      governing: decisions.filter(d => (d.governs || []).length > 0).length,
    },
  }
}

export function groupDecisionsByProject(decisions = []) {
  return decisions.reduce((groups, decision) => {
    const key = decision.project_id || '_none'
    if (!groups[key]) groups[key] = []
    groups[key].push(decision)
    return groups
  }, {})
}

/**
 * Group decisions into supersession lineages — how the thinking got here (ADR-0118).
 *
 * A lineage is headed by a decision nothing (visible) supersedes and runs backwards
 * through `supersedes` to the oldest record it replaced. A decision with no relations is
 * a lineage of one, which is what almost all of them are today; the shape is the same
 * either way so the view never needs two renderings.
 *
 * Resolution happens within the *visible* set, the same rule the structure map and the
 * board follow (ADR-0069, ADR-0094): filtering a project out promotes its children to
 * heads instead of hiding them behind a parent that is not on screen.
 */
export function buildDecisionLineages(decisions = []) {
  const byId = new Map(decisions.map(d => [d.id, d]))
  const visible = (refs) => (refs || []).map(r => r.id).filter(id => byId.has(id))
  const seen = new Set()

  // `parentId` is the decision one step *newer* in the chain — the one whose
  // `supersedes` edge put this row here. The rail that draws the chain is that edge, so
  // the control that withdraws it belongs on the rail; without naming the parent the
  // connector would be a picture of a relation you could not act on.
  const walk = (decision, depth, parentId) => {
    if (!decision || seen.has(decision.id)) return []
    seen.add(decision.id)
    const rows = [{ decision, depth, parentId }]
    for (const id of visible(decision.supersedes)) rows.push(...walk(byId.get(id), depth + 1, decision.id))
    return rows
  }

  const lineage = (decision) => {
    const chain = walk(decision, 0, null)
    if (!chain.length) return null
    // The ids drawn in this chain. A card inside one suppresses the relation chips the
    // rail already states, and keeps the ones pointing outside it (ADR-0069's rule for
    // resolving within the visible set, applied to a card's own text).
    return { id: decision.id, head: decision, chain, chainIds: new Set(chain.map(r => r.decision.id)) }
  }

  const lineages = []
  for (const decision of decisions) {
    if (visible(decision.superseded_by).length) continue
    const built = lineage(decision)
    if (built) lineages.push(built)
  }
  // Anything left is in a supersession cycle — impossible through the API, possible in
  // data written by hand. Show it rather than silently dropping it.
  for (const decision of decisions) {
    if (seen.has(decision.id)) continue
    const built = lineage(decision)
    if (built) lineages.push(built)
  }

  // Longest first: a chain is the part of this page that carries history. Sort is stable,
  // so equal-length lineages keep the server's newest-first order.
  return lineages.sort((a, b) => b.chain.length - a.chain.length)
}

/**
 * Split lineages into the ones that carry history and the ones that are a single record.
 *
 * A chain of one is a decision, not a lineage. Production holds 103 decision records and
 * one supersession edge, so a "LINEAGE" column that lists every outcome is 102 identical
 * single cards and one chain — a list wearing the name of a graph, in which the one real
 * chain is invisible. Keeping the sections apart makes the chain count mean what it says,
 * and gives the empty state something true to say when there is nothing to draw.
 */
export function splitLineages(lineages = []) {
  const chains = []
  const singles = []
  for (const lineage of lineages) {
    (lineage.chain.length > 1 ? chains : singles).push(lineage)
  }
  return { chains, singles }
}

/**
 * File lineages under the containers they live in (ADR-0126).
 *
 * A decision is a node, so it lives somewhere: production's 103 records sit under 16
 * distinct `contains` trails across two organizations. The page drew none of that — a
 * project's *name* appeared as grey meta text on each card and the level above it
 * appeared nowhere, so the only structure on screen was supersession, of which there
 * are two edges. The result is one flat column ~90 cards long in which nothing says
 * what belongs with what.
 *
 * `ancestry` is `GET /graph/ancestry`'s answer (ADR-0094), root-first with the direct
 * parent last, so the trail of a decision *ends* at its project. Trails are folded into
 * a trie, which is why an organization holding four projects is one row and not four.
 *
 * The group of a chain is the group of its head: supersession candidates are restricted
 * to one project (`SupersedePicker`), so a chain never spans two.
 *
 * A decision whose trail is empty — nothing contains it, or ancestry has not loaded —
 * comes back under `loose` rather than being dropped or given an invented parent.
 */
export function buildDecisionGroups(lineages = [], ancestry = {}) {
  const make = (ref, id) => ({ id, ref, children: new Map(), lineages: [], total: 0 })
  const root = make(null, '')

  for (const lineage of lineages) {
    const trail = (ancestry[lineage.head.id]?.trails || [])[0] || []
    let node = root
    for (const ref of trail) {
      let child = node.children.get(ref.id)
      if (!child) {
        child = make(ref, node.id ? `${node.id}/${ref.id}` : ref.id)
        node.children.set(ref.id, child)
      }
      node = child
    }
    node.lineages.push(lineage)
  }

  // `total` counts decision *records*, not lineages: a chain of three is three records,
  // and a group header claiming "1" above three cards is the kind of count ADR-0068
  // exists to prevent.
  const finalize = (node) => {
    const children = [...node.children.values()].map(finalize)
    const own = node.lineages.reduce((n, l) => n + l.chain.length, 0)
    return {
      id: node.id,
      ref: node.ref,
      children,
      lineages: node.lineages,
      total: own + children.reduce((n, c) => n + c.total, 0),
    }
  }

  const built = finalize(root)
  // Deepest-first would put a bare project above an organization holding four of them;
  // biggest-first matches how the column is read.
  const sortGroups = (groups) => {
    groups.sort((a, b) => b.total - a.total)
    groups.forEach(g => sortGroups(g.children))
    return groups
  }

  return { groups: sortGroups(built.children), loose: built.lineages, total: built.total }
}

/**
 * Wrap plain decisions as lineages of one.
 *
 * The queue lists records, not histories, but it is filed under the same containment
 * groups as the outcomes are — and a grouper that took two shapes would be two groupers.
 */
export function soloLineages(decisions = []) {
  return decisions.map(decision => ({
    id: decision.id,
    head: decision,
    chain: [{ decision, depth: 0, parentId: null }],
    chainIds: new Set([decision.id]),
  }))
}

/** Does this decision match a free-text query? Name, then body, then the project it is
 *  filed under — a decision's title is an ADR line ("ADR-0118: …"), so typing a number
 *  has to reach it. */
export function decisionMatches(decision, query, projectName = '') {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [decision.name, decision.description, projectName]
    .some(field => (field || '').toLowerCase().includes(q))
}
