import { STATUS_COLOR } from '../constants/theme'
import { taskRisk } from './structureMap'
import { hasNodeRole } from '../constants/nodeRoles'

// Full graph-native derivation for the structure map (ADR-0037): consumes the
// raw /graph/map slice (with data) plus the type registries and produces the
// same shape deriveStructureMap built from the entity APIs — so the visual
// layer (territory / mindmap / network) keeps working while roles come from
// the registry instead of hardcoded entity kinds:
//   - every container-role node (project or custom) becomes a "project" card
//   - every task-role node (task or custom task-like) becomes a task chip
//   - custom plain nodes and custom edge types surface in the network view
// Map-role `type` stays 'project'/'task'/… for the renderers; the real type
// key travels alongside as `typeKey`/`typeLabel`/`typeColor`.

const KNOWN_RELS = new Set(['owns', 'depends_on', 'labeled', 'in_cycle'])

export function deriveGraphStructure(slice, nodeTypes = [], edgeTypes = [], now = new Date()) {
  const nodes = slice?.nodes || []
  const edges = slice?.edges || []

  const typeByKey = new Map(nodeTypes.map(nt => [nt.key, nt]))
  const containerKeys = new Set(nodeTypes.filter(nt => hasNodeRole(nt, 'container')).map(nt => nt.key))
  const taskKeys = new Set(nodeTypes.filter(nt => hasNodeRole(nt, 'task')).map(nt => nt.key))
  const containmentRels = new Set(edgeTypes.filter(et => et.is_containment).map(et => et.key))
  const customRels = new Map(
    edgeTypes
      .filter(et => !et.is_builtin && !et.is_containment && !KNOWN_RELS.has(et.key))
      .map(et => [et.key, et])
  )

  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const isContainer = (n) => containerKeys.has(n.type)
  const isTask = (n) => taskKeys.has(n.type)

  // --- Edge indexes (edge order is server-deterministic: position, created_at)
  const parentsOf = new Map()   // child id -> [parent node, ...] via containment
  const childrenOf = new Map()  // parent id -> [child node, ...] via containment
  const memberOf = new Map()    // container id -> [identity id, ...]
  const blockedBy = new Map()   // task id -> [prerequisite task id, ...]
  const blocking = new Map()    // task id -> [dependent task id, ...]
  const customEdges = []

  for (const e of edges) {
    const src = nodeById.get(e.source_id)
    const dst = nodeById.get(e.target_id)
    if (!src || !dst) continue
    if (containmentRels.has(e.rel_type)) {
      if (!parentsOf.has(dst.id)) parentsOf.set(dst.id, [])
      parentsOf.get(dst.id).push(src)
      if (!childrenOf.has(src.id)) childrenOf.set(src.id, [])
      childrenOf.get(src.id).push(dst)
    } else if (e.rel_type === 'owns' && src.type === 'identity') {
      if (!memberOf.has(dst.id)) memberOf.set(dst.id, [])
      memberOf.get(dst.id).push(src.id)
    } else if (e.rel_type === 'depends_on') {
      if (!blockedBy.has(src.id)) blockedBy.set(src.id, [])
      blockedBy.get(src.id).push(dst.id)
      if (!blocking.has(dst.id)) blocking.set(dst.id, [])
      blocking.get(dst.id).push(src.id)
    } else if (customRels.has(e.rel_type)) {
      customEdges.push(e)
    }
  }

  const containerParentOf = (id) => (parentsOf.get(id) || []).find(isContainer) || null
  const taskParentOf = (id) => (parentsOf.get(id) || []).find(isTask) || null

  // --- Tasks (top-level task-role nodes with a container home)
  const allTaskNodes = []
  for (const n of nodes) {
    if (!isTask(n)) continue
    if (taskParentOf(n.id)) continue // subtasks stay inside their parent row
    const home = containerParentOf(n.id)
    if (!home) continue // unfiled tasks live in /unfiled, not on the map
    const risk = taskRisk(n, now)
    const nt = typeByKey.get(n.type)
    const signal = risk !== 'normal' || n.status !== 'todo' || n.priority === 'high'
    allTaskNodes.push({
      id: n.id,
      type: 'task',
      typeKey: n.type,
      typeLabel: nt?.label || n.type,
      typeColor: nt?.color || null,
      isCustomType: !nt?.is_builtin,
      projectId: home.id,
      name: n.title,
      status: n.status,
      priority: n.priority,
      assignee: n.data?.assignee || null,
      risk,
      signal,
      blockedBy: blockedBy.get(n.id) || [],
      blocking: blocking.get(n.id) || [],
      color: STATUS_COLOR[n.status] || STATUS_COLOR.todo,
    })
  }
  const taskNodes = allTaskNodes.filter(task => task.signal)
  const dependencyTaskNodes = allTaskNodes.filter(
    task => task.signal || task.blockedBy.length > 0 || task.blocking.length > 0
  )

  // --- Decisions (label nodes whose data kind is 'decision')
  const decisionNodes = nodes
    .filter(n => n.type === 'label' && n.data?.type === 'decision')
    .map(n => ({
      id: n.id,
      type: 'decision',
      name: n.title,
      status: n.data?.decision_status || 'proposed',
      projectId: containerParentOf(n.id)?.id || null,
    }))
  const decisionsByContainer = new Map()
  for (const d of decisionNodes) {
    if (!d.projectId) continue
    if (!decisionsByContainer.has(d.projectId)) decisionsByContainer.set(d.projectId, [])
    decisionsByContainer.get(d.projectId).push(d)
  }

  // Tasks anywhere below a container, top-level ones only — the size rule the
  // server reports (ADR-0068), applied here because the map derives its own
  // enrichment from the graph slice (ADR-0037). A card that counted only direct
  // children would contradict the project page the moment anything is nested.
  const subtreeTasksOf = (id, seen = new Set()) => {
    if (seen.has(id)) return []
    seen.add(id)
    const out = []
    for (const child of childrenOf.get(id) || []) {
      if (isTask(child)) {
        if (!taskParentOf(child.id)) out.push(child)
      } else if (isContainer(child)) {
        out.push(...subtreeTasksOf(child.id, seen))
      }
    }
    return out
  }

  // --- Containers ("project" cards; enrichment computed from the graph)
  const projectNodes = nodes.filter(isContainer).map(n => {
    const directTasks = (childrenOf.get(n.id) || []).filter(isTask)
    const taskChildren = subtreeTasksOf(n.id)
    const failed = taskChildren.filter(x => x.status === 'failed').length
    const overdue = taskChildren.filter(x => taskRisk(x, now) === 'overdue').length
    const inProgress = taskChildren.filter(x => x.status === 'in_progress').length
    const done = taskChildren.filter(x => x.status === 'done').length
    const decisions = decisionsByContainer.get(n.id) || []
    const nt = typeByKey.get(n.type)
    const risk = failed > 0 ? 'failed' : overdue > 0 ? 'overdue' : inProgress > 0 ? 'active' : 'normal'
    return {
      id: n.id,
      type: 'project',
      typeKey: n.type,
      typeLabel: nt?.label || n.type,
      typeColor: nt?.color || null,
      isCustomType: !nt?.is_builtin,
      parentContainerId: containerParentOf(n.id)?.id || null,
      name: n.title,
      status: n.status || 'active',
      progress: taskChildren.length ? Math.round((done / taskChildren.length) * 100) : 0,
      totalTasks: taskChildren.length,
      doneTasks: done,
      // What this container holds itself, so a card can say how much of its
      // total lives in the containers below it.
      directTaskCount: directTasks.filter(x => !taskParentOf(x.id)).length,
      failed,
      overdue,
      inProgress,
      dependencyCount: taskChildren.reduce((total, x) => total + (blockedBy.get(x.id) || []).length, 0),
      decisionCount: decisions.length,
      pendingDecisionCount: decisions.filter(d => d.status === 'proposed').length,
      identityIds: memberOf.get(n.id) || [],
      risk,
    }
  })
  const projectById = new Map(projectNodes.map(p => [p.id, p]))

  // --- Identities
  const identityNodes = nodes
    .filter(n => n.type === 'identity')
    .map(n => {
      const linked = projectNodes.filter(p => p.identityIds.includes(n.id))
      return {
        id: n.id,
        type: 'identity',
        name: n.title,
        avatar: n.data?.avatar || null,
        color: n.data?.color || '#facc15',
        projectCount: linked.length,
        projectIds: linked.map(p => p.id),
        shareActive: Boolean(n.data?.share_token || n.data?.share_pin_set),
      }
    })

  // --- Goals render as container cards (ADR-0041): a goal carries the container
  // role, so it is already a "project" card above and its members are ordinary
  // ``contains`` children. The dedicated goal-node derivation is retired; the map's
  // goal rail/lane simply stays empty.
  const goalNodes = []

  // --- Custom plain nodes (neither container nor task role, non-builtin type)
  const keyOf = (id) => {
    const n = nodeById.get(id)
    if (!n) return null
    if (projectById.has(id)) return `project:${id}`
    if (isTask(n)) return `task:${id}`
    if (n.type === 'identity') return `identity:${id}`
    if (n.type === 'label') return `decision:${id}`
    return `custom:${id}`
  }
  const customNodes = nodes
    .filter(n => {
      const nt = typeByKey.get(n.type)
      return nt && !nt.is_builtin && !isContainer(n) && !isTask(n)
    })
    .map(n => {
      const nt = typeByKey.get(n.type)
      return {
        id: n.id,
        type: 'custom',
        typeKey: n.type,
        typeLabel: nt?.label || n.type,
        typeColor: nt?.color || '#818cf8',
        name: n.title,
        status: n.status || null,
        parentProjectId: containerParentOf(n.id)?.id || null,
      }
    })
  const customNodeIds = new Set(customNodes.map(n => n.id))

  // --- Links (legacy vocabulary) + custom relation links
  const links = []
  for (const p of projectNodes) {
    for (const identityId of p.identityIds) {
      links.push({ from: `identity:${identityId}`, to: `project:${p.id}`, type: 'owns' })
    }
  }
  for (const task of taskNodes) {
    links.push({ from: `project:${task.projectId}`, to: `task:${task.id}`, type: task.risk })
  }
  for (const decision of decisionNodes) {
    if (decision.projectId && projectById.has(decision.projectId)) {
      links.push({ from: `decision:${decision.id}`, to: `project:${decision.projectId}`, type: decision.status })
    }
  }
  // Containment between two containers (nested layers): navigable structure. A
  // container may have several container parents (e.g. a project grouped under a
  // goal *and* a topic), so draw a link for every container parent, not just the
  // nearest one — this is how goal -> project relationships surface (ADR-0041).
  for (const p of projectNodes) {
    for (const parent of (parentsOf.get(p.id) || []).filter(isContainer)) {
      if (projectById.has(parent.id)) {
        links.push({ from: `project:${parent.id}`, to: `project:${p.id}`, type: 'contains' })
      }
    }
  }
  // Custom containment targets: a custom plain node contained by a container.
  for (const id of customNodeIds) {
    const parent = containerParentOf(id)
    if (parent && projectById.has(parent.id)) {
      links.push({ from: `project:${parent.id}`, to: `custom:${id}`, type: 'contains' })
    }
  }

  const customLinks = customEdges
    .map(e => {
      const from = keyOf(e.source_id)
      const to = keyOf(e.target_id)
      if (!from || !to) return null
      return { from, to, relType: e.rel_type, label: customRels.get(e.rel_type)?.label || e.rel_type }
    })
    .filter(Boolean)

  const dependencyLinks = []
  const dependencyTaskIds = new Set(dependencyTaskNodes.map(task => task.id))
  for (const task of dependencyTaskNodes) {
    for (const blockerId of task.blockedBy) {
      if (dependencyTaskIds.has(blockerId)) {
        dependencyLinks.push({
          from: `task:${blockerId}`,
          to: `task:${task.id}`,
          type: 'dependency',
          projectId: task.projectId,
        })
      }
    }
  }

  const unownedProjects = projectNodes.filter(p => p.identityIds.length === 0)
  const stats = {
    identities: identityNodes.length,
    projects: projectNodes.length,
    tasks: taskNodes.length,
    goals: projectNodes.filter(p => p.typeKey === 'goal').length,
    decisions: decisionNodes.length,
    customNodes: customNodes.length,
    failedProjects: projectNodes.filter(p => p.failed > 0).length,
    overdueProjects: projectNodes.filter(p => p.overdue > 0).length,
    unownedProjects: unownedProjects.length,
    dependencies: dependencyLinks.length,
  }

  return {
    identityNodes,
    projectNodes,
    taskNodes,
    allTaskNodes,
    dependencyTaskNodes,
    goalNodes,
    decisionNodes,
    customNodes,
    links,
    customLinks,
    dependencyLinks,
    stats,
    // Raw containment index, kept for focusGraph (ADR-0081): a focus target may
    // be any container-role node, not just identity, so narrowing needs a real
    // downward contains-walk rather than a single identity-id match.
    childrenOf,
  }
}

// Narrow a derived graph to one focus target's world (focus rail, ADR-0081):
// the target itself, everything nested under it via `contains` (sub-containers,
// identities, directly-filed projects), and every project owned (`owns`) by an
// identity in that branch.
export function focusGraph(graph, focusId) {
  if (!focusId) return graph
  const branch = new Set([focusId])
  const queue = [focusId]
  while (queue.length) {
    const current = queue.shift()
    for (const child of graph.childrenOf?.get(current) || []) {
      if (!branch.has(child.id)) {
        branch.add(child.id)
        queue.push(child.id)
      }
    }
  }
  const identityIdsInBranch = new Set(graph.identityNodes.filter(i => branch.has(i.id)).map(i => i.id))
  const projectNodes = graph.projectNodes.filter(
    p => branch.has(p.id) || p.identityIds.some(id => identityIdsInBranch.has(id))
  )
  const keep = new Set(projectNodes.map(p => p.id))
  const taskNodes = graph.taskNodes.filter(t => keep.has(t.projectId))
  const allTaskNodes = graph.allTaskNodes.filter(t => keep.has(t.projectId))
  const dependencyTaskNodes = graph.dependencyTaskNodes.filter(t => keep.has(t.projectId))
  const keptTaskIds = new Set(dependencyTaskNodes.map(t => t.id))
  const identityNodes = graph.identityNodes.filter(i => identityIdsInBranch.has(i.id))
  // Goals render as container cards (ADR-0041); no dedicated goal-node set remains.
  const goalNodes = []
  const decisionNodes = graph.decisionNodes.filter(d => d.projectId && keep.has(d.projectId))
  const customNodes = graph.customNodes.filter(n => n.parentProjectId && keep.has(n.parentProjectId))
  const keptKeys = new Set([
    ...projectNodes.map(p => `project:${p.id}`),
    ...taskNodes.map(t => `task:${t.id}`),
    ...identityNodes.map(i => `identity:${i.id}`),
    ...decisionNodes.map(d => `decision:${d.id}`),
    ...customNodes.map(n => `custom:${n.id}`),
  ])
  const dependencyLinks = graph.dependencyLinks.filter(
    l => keptTaskIds.has(l.from.replace('task:', '')) && keptTaskIds.has(l.to.replace('task:', ''))
  )
  return {
    ...graph,
    identityNodes,
    projectNodes,
    taskNodes,
    allTaskNodes,
    dependencyTaskNodes,
    goalNodes,
    decisionNodes,
    customNodes,
    links: graph.links.filter(l => keptKeys.has(l.from) && keptKeys.has(l.to)),
    customLinks: graph.customLinks.filter(l => keptKeys.has(l.from) && keptKeys.has(l.to)),
    dependencyLinks,
    stats: {
      ...graph.stats,
      identities: identityNodes.length,
      projects: projectNodes.length,
      tasks: taskNodes.length,
      goals: projectNodes.filter(p => p.typeKey === 'goal').length,
      decisions: decisionNodes.length,
      customNodes: customNodes.length,
      failedProjects: projectNodes.filter(p => p.failed > 0).length,
      overdueProjects: projectNodes.filter(p => p.overdue > 0).length,
      unownedProjects: projectNodes.filter(p => p.identityIds.length === 0).length,
      dependencies: dependencyLinks.length,
    },
  }
}
