// The share payload, projected into the slice the structure map already speaks.
//
// The public page carried every relation it draws — a task's `blocked_by`, a parent's
// `subtasks`, a decision's `supersedes`/`governs` — and rendered all of them as text,
// each readable from one end only: a task's expander said "Blocked by: X" and X said
// nothing back, a decision named the work it governs and the work never named the
// decision. Drawing them needs no new endpoint, only the same `{nodes, edges}` shape
// `GET /api/graph/map` returns, so `deriveGraphStructure` and the layout algorithms
// serve the share page unchanged rather than gaining a public-facing twin.
//
// Pure on purpose: this is the whole translation, so it is tested without a DOM.

// The registries the derivation reads. A public visitor has no access to
// `/graph-types`, and the payload only ever holds these four kinds — the server
// flattens a shared subtree into `projects` — so they are stated rather than fetched.
// `is_builtin` is true throughout: nothing here is a custom type, which is what keeps
// the derivation's "custom plain node" lane empty.
export const SHARE_NODE_TYPES = [
  { key: 'identity', label: 'Identity', is_builtin: true, roles: ['container'] },
  { key: 'project', label: 'Project', is_builtin: true, roles: ['container'] },
  { key: 'task', label: 'Task', is_builtin: true, roles: ['task'] },
  // A decision carries no roles (ADR-0118), so it stays out of every rollup here too.
  { key: 'decision', label: 'Decision', is_builtin: true, roles: [] },
]

export const SHARE_EDGE_TYPES = [
  { key: 'contains', label: 'contains', is_containment: true },
  { key: 'owns', label: 'owns', is_containment: false },
  { key: 'depends_on', label: 'depends on', is_containment: false },
  { key: 'governs', label: 'governs', is_containment: false },
  { key: 'supersedes', label: 'supersedes', is_containment: false },
]

/**
 * @param payload the body of `GET /share/node/{token}`
 * @returns `{nodes, edges}` in the `/graph/map` shape, holding only what the payload
 *          already shows. Edges whose far end is not in the payload are dropped here
 *          rather than left dangling — a cross-project `supersedes` whose other half
 *          was not shared must not draw a line to nothing.
 */
export function buildShareSlice(payload) {
  const nodes = []
  const edges = []
  const nodeIds = new Set()
  const edgeIds = new Set()

  const addNode = (node) => {
    if (nodeIds.has(node.id)) return
    nodeIds.add(node.id)
    nodes.push({ status: null, priority: null, due_date: null, data: {}, ...node })
  }
  const addEdge = (source_id, target_id, rel_type) => {
    const id = `${rel_type}:${source_id}:${target_id}`
    if (edgeIds.has(id) || source_id === target_id) return
    edgeIds.add(id)
    edges.push({ id, source_id, target_id, rel_type })
  }

  const projects = (payload?.projects || []).filter(p => p.status === 'active')
  // Only an identity share has an owner distinct from the work: for a project or a
  // generic container the payload's `identity` block *is* the shared node, restated
  // as a page header, and emitting it again would draw the project twice.
  const owner = payload?.meta?.scope === 'identity' ? payload?.identity : null

  if (owner?.id) {
    addNode({
      id: owner.id,
      type: 'identity',
      title: owner.name,
      status: 'active',
      data: { color: owner.color, avatar: owner.avatar },
    })
  }

  for (const project of projects) {
    addNode({ id: project.id, type: 'project', title: project.name, status: project.status || 'active' })
    if (owner?.id) addEdge(owner.id, project.id, 'owns')

    for (const task of project.tasks || []) {
      addNode({
        id: task.id,
        type: 'task',
        title: task.title,
        status: task.status,
        priority: task.priority,
        due_date: task.due_date,
      })
      addEdge(project.id, task.id, 'contains')
      // A subtask is work (ADR-0094) and it is a node here, but a task parent keeps it
      // inside its parent's row — which is also the ADR-0068 size rule, applied by the
      // derivation itself rather than restated here.
      for (const sub of task.subtasks || []) {
        addNode({ id: sub.id, type: 'task', title: sub.title, status: sub.status, priority: sub.priority })
        addEdge(task.id, sub.id, 'contains')
      }
    }

    for (const decision of project.decisions || []) {
      addNode({
        id: decision.id,
        type: 'decision',
        title: decision.name,
        // The state lives on the column for every other type and now for this one too
        // (ADR-0130); the payload spells the field `decision_status`, the slice does not.
        status: decision.decision_status || 'proposed',
      })
      addEdge(project.id, decision.id, 'contains')
    }
  }

  // Relations, once every node exists: a dependency or a supersession may name a task
  // or a decision declared under a later project than the one that mentions it.
  for (const project of projects) {
    for (const task of project.tasks || []) {
      // `blocked_by` and `blocking` are the same row read from two ends; taking only
      // one direction is what keeps a dependency from being drawn twice.
      for (const dep of task.blocked_by || []) addEdge(task.id, dep.id, 'depends_on')
    }
    for (const decision of project.decisions || []) {
      for (const other of decision.supersedes || []) addEdge(decision.id, other.id, 'supersedes')
      for (const other of decision.superseded_by || []) addEdge(other.id, decision.id, 'supersedes')
      for (const target of decision.governs || []) addEdge(decision.id, target.id, 'governs')
    }
  }

  return {
    nodes,
    edges: edges.filter(e => nodeIds.has(e.source_id) && nodeIds.has(e.target_id)),
  }
}
