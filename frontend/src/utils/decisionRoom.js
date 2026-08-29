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
