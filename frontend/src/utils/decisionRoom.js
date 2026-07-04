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
