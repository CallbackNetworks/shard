import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, GitFork, Maximize2, Minus, Network, Plus, Search, Target, UserRound } from 'lucide-react'
import { getDecisions, getGoals, getIdentities, getProjects } from '../api/client'
import { STATUS_COLOR } from '../constants/theme'
import { dependencyNeighborhood, deriveStructureMap } from '../utils/structureMap'
import EmptyState from '../components/shared/EmptyState'

const FILTERS = ['all', 'active', 'risk', 'unowned']
const VIEW_MODES = ['map', 'dependencies']
const STYLE_MODES = ['sankey', 'lines', 'network']

function riskColor(risk) {
  if (risk === 'failed' || risk === 'overdue') return STATUS_COLOR.failed
  if (risk === 'active' || risk === 'priority') return STATUS_COLOR.in_progress
  return STATUS_COLOR.todo
}

function nodeDataKey(node) {
  if (!node) return null
  return node.type === 'root' ? node.id : `${node.type}:${node.id}`
}

function taskWeight(task) {
  const riskScore = {
    failed: 90,
    overdue: 80,
    priority: 70,
    active: 60,
    normal: 10,
  }[task.risk] || 10
  return riskScore + (task.blockedBy?.length || 0) * 12 + (task.blocking?.length || 0) * 10
}

function hasInspectorMetrics(node) {
  return ['project', 'identity', 'task', 'goal', 'decision'].includes(node?.type)
}

function Stat({ label, value, color }) {
  return (
    <div className="kt-map-stat" style={{ '--map-color': color || STATUS_COLOR.in_progress }}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}

function GraphNode({ children, active, muted, color, label, onClick, onDoubleClick, className = '', style }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={[
        'kt-map-node',
        active ? 'is-active' : '',
        muted ? 'is-muted' : '',
        className,
      ].filter(Boolean).join(' ')}
      style={{ '--node-color': color, ...style }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {children}
    </button>
  )
}

function resolveOverlaps(items, minGap) {
  if (items.length <= 1) return
  items.sort((a, b) => a.y - b.y)
  for (let i = 1; i < items.length; i++) {
    const minY = items[i - 1].y + items[i - 1].h + minGap
    if (items[i].y < minY) items[i].y = minY
  }
}

function computePath(from, to, linkType) {
  const fromCy = from.y + from.h / 2
  const toCy = to.y + to.h / 2
  const dx = (to.x + to.w / 2) - (from.x + from.w / 2)

  if (linkType === 'dependency') {
    const x1 = from.x + from.w
    const x2 = to.x + to.w
    const arc = 28 + Math.abs(toCy - fromCy) * 0.1
    return `M ${x1} ${fromCy} C ${x1 + arc} ${fromCy}, ${x2 + arc} ${toCy}, ${x2} ${toCy}`
  }

  if (Math.abs(dx) > 80) {
    const goRight = dx > 0
    const x1 = goRight ? from.x + from.w : from.x
    const x2 = goRight ? to.x : to.x + to.w
    const bend = Math.max(20, Math.abs(x2 - x1) * 0.35)
    const dir = goRight ? 1 : -1
    return `M ${x1} ${fromCy} C ${x1 + dir * bend} ${fromCy}, ${x2 - dir * bend} ${toCy}, ${x2} ${toCy}`
  }

  const goDown = toCy > fromCy
  const x1 = from.x + from.w / 2
  const y1 = goDown ? from.y + from.h : from.y
  const x2 = to.x + to.w / 2
  const y2 = goDown ? to.y : to.y + to.h
  const bend = Math.max(20, Math.abs(y2 - y1) * 0.4)
  const dir = goDown ? 1 : -1
  return `M ${x1} ${y1} C ${x1} ${y1 + dir * bend}, ${x2} ${y2 - dir * bend}, ${x2} ${y2}`
}

function buildMindMapLayout({ visibleProjects, visibleIdentityNodes, visibleTaskNodes, laneNodes, dependencyLinks, viewMode }) {
  const pad = { x: 120, y: 80 }
  const colDef = {
    identity: { x: pad.x + 24, w: 138 },
    project: { x: pad.x + 228, w: 196 },
    task: { x: pad.x + 490, w: 176 },
  }
  const contentW = 710
  const canvasW = contentW + pad.x * 2
  const labelH = 24
  const projectH = 62
  const taskH = 46
  const identityH = 46
  const goalH = 38
  const decisionH = 38
  const taskGapV = 4
  const rowPad = 10

  const tasksByProject = new Map()
  visibleTaskNodes.forEach(task => {
    if (!tasksByProject.has(task.projectId)) tasksByProject.set(task.projectId, [])
    tasksByProject.get(task.projectId).push(task)
  })

  const goalLane = laneNodes.filter(n => n.lane === 'goal')
  const decisionLane = laneNodes.filter(n => n.lane === 'decision')
  const goalCols = Math.min(goalLane.length, 3) || 1
  const goalRows = Math.ceil(goalLane.length / goalCols)
  const goalAreaH = goalLane.length > 0 ? goalRows * (goalH + 6) + 8 : 0

  const bodyTop = pad.y + labelH + goalAreaH + 6

  const projectRowData = []
  let bodyY = bodyTop
  visibleProjects.forEach(project => {
    const tasks = tasksByProject.get(project.id) || []
    const stackH = tasks.length > 0 ? tasks.length * (taskH + taskGapV) - taskGapV : 0
    const rowH = Math.max(projectH, stackH) + rowPad
    projectRowData.push({ project, y: bodyY, h: rowH, tasks })
    bodyY += rowH
  })

  const nodes = []
  const links = []

  projectRowData.forEach(row => {
    const py = row.y + (row.h - rowPad - projectH) / 2
    nodes.push({
      id: `project:${row.project.id}`,
      type: 'project',
      name: row.project.name,
      x: colDef.project.x,
      y: py,
      w: colDef.project.w,
      h: projectH,
      color: riskColor(row.project.risk),
      data: row.project,
    })
  })

  const projectYMap = new Map(
    nodes.filter(n => n.type === 'project').map(n => [n.data.id, n.y])
  )

  const identityItems = visibleIdentityNodes.map((identity, i) => {
    const connYs = visibleProjects
      .filter(p => p.identityIds.includes(identity.id))
      .map(p => projectYMap.get(p.id))
      .filter(y => y !== undefined)
    const idealY = connYs.length > 0
      ? connYs.reduce((a, b) => a + b, 0) / connYs.length + (projectH - identityH) / 2
      : bodyTop + i * (identityH + 8)
    return { identity, y: idealY, h: identityH }
  })
  resolveOverlaps(identityItems, 8)

  identityItems.forEach(({ identity, y }) => {
    nodes.push({
      id: `identity:${identity.id}`,
      type: 'identity',
      name: identity.name,
      x: colDef.identity.x,
      y,
      w: colDef.identity.w,
      h: identityH,
      color: identity.color,
      data: { ...identity, type: 'identity' },
    })
  })

  const identityColorById = new Map(visibleIdentityNodes.map(identity => [identity.id, identity.color]))
  visibleProjects.forEach(project => {
    project.identityIds.forEach(identityId => {
      links.push({
        from: `identity:${identityId}`,
        to: `project:${project.id}`,
        color: identityColorById.get(identityId) || '#64748b',
        type: 'owns',
        flow: true,
      })
    })
  })

  projectRowData.forEach(row => {
    const py = projectYMap.get(row.project.id)
    if (py === undefined) return
    const tasks = row.tasks
    const stackH = tasks.length > 0 ? tasks.length * (taskH + taskGapV) - taskGapV : 0
    const stackTop = py + (projectH - stackH) / 2

    tasks.forEach((task, i) => {
      nodes.push({
        id: `task:${task.id}`,
        type: 'task',
        name: task.name,
        x: colDef.task.x,
        y: stackTop + i * (taskH + taskGapV),
        w: colDef.task.w,
        h: taskH,
        color: task.color,
        data: task,
      })
      links.push({
        from: `project:${row.project.id}`,
        to: `task:${task.id}`,
        color: viewMode === 'dependencies' ? '#737373' : riskColor(task.risk),
        type: task.risk,
        flow: true,
      })
    })
  })

  if (viewMode === 'dependencies') {
    dependencyLinks.forEach(link => {
      links.push({
        from: link.from,
        to: link.to,
        color: STATUS_COLOR.failed,
        type: 'dependency',
      })
    })
  }

  const goalW = 138
  const goalGapH = 8
  const totalGoalW = goalCols * goalW + (goalCols - 1) * goalGapH
  const goalStartX = colDef.project.x + (colDef.project.w - totalGoalW) / 2

  goalLane.forEach((goal, i) => {
    nodes.push({
      id: `goal:${goal.id}`,
      type: 'goal',
      name: goal.name,
      x: goalStartX + (i % goalCols) * (goalW + goalGapH),
      y: pad.y + labelH + Math.floor(i / goalCols) * (goalH + 6),
      w: goalW,
      h: goalH,
      color: goal.color,
      data: goal,
    })
    goal.projectIds?.forEach(projectId => links.push({
      from: `goal:${goal.id}`,
      to: `project:${projectId}`,
      color: goal.color,
      type: 'goal',
    }))
  })

  const decisionTop = bodyY + 12
  const decisionColCount = Math.min(decisionLane.length, 3) || 1
  const decW = 134
  const decGapH = 8
  const totalDecW = decisionColCount * decW + (decisionColCount - 1) * decGapH
  const decStartX = colDef.project.x + (colDef.project.w - totalDecW) / 2

  decisionLane.forEach((decision, i) => {
    nodes.push({
      id: `decision:${decision.id}`,
      type: 'decision',
      name: decision.name,
      x: decStartX + (i % decisionColCount) * (decW + decGapH),
      y: decisionTop + Math.floor(i / decisionColCount) * (decisionH + 6),
      w: decW,
      h: decisionH,
      color: decision.color,
      data: decision,
    })
    if (decision.projectId) {
      links.push({
        from: `decision:${decision.id}`,
        to: `project:${decision.projectId}`,
        color: decision.color,
        type: 'decision',
      })
    }
  })

  const decAreaH = decisionLane.length > 0 ? Math.ceil(decisionLane.length / decisionColCount) * (decisionH + 6) + 24 : 0
  const canvasH = Math.max(520, bodyY + decAreaH + pad.y + 40)

  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const validLinks = links.filter(l => nodeById.has(l.from) && nodeById.has(l.to))
  assignSankeySlots(validLinks, nodeById)
  return {
    nodes,
    links: validLinks,
    nodeById,
    width: canvasW,
    height: canvasH,
    columns: colDef,
    labelH,
    padY: pad.y,
  }
}

const RIBBON_MAX = 20

function nodeCenterY(node) {
  return node.y + node.h / 2
}

// Allocate stacked vertical slots on each node edge for flow ribbons,
// so ribbons fan out along the node height instead of all meeting at the center.
function assignSankeySlots(links, nodeById) {
  const outgoing = new Map()
  const incoming = new Map()
  for (const link of links) {
    if (!link.flow) continue
    if (!outgoing.has(link.from)) outgoing.set(link.from, [])
    if (!incoming.has(link.to)) incoming.set(link.to, [])
    outgoing.get(link.from).push(link)
    incoming.get(link.to).push(link)
  }

  for (const [nodeId, group] of outgoing) {
    const node = nodeById.get(nodeId)
    group.sort((a, b) => nodeCenterY(nodeById.get(a.to)) - nodeCenterY(nodeById.get(b.to)))
    const usable = node.h - 8
    const slot = usable / group.length
    group.forEach((link, i) => {
      link.sourceX = node.x + node.w
      link.sourceY = node.y + 4 + (i + 0.5) * slot
      link.sourceW = Math.min(slot - 1.5, RIBBON_MAX)
    })
  }

  for (const [nodeId, group] of incoming) {
    const node = nodeById.get(nodeId)
    group.sort((a, b) => nodeCenterY(nodeById.get(a.from)) - nodeCenterY(nodeById.get(b.from)))
    const usable = node.h - 8
    const slot = usable / group.length
    group.forEach((link, i) => {
      link.targetX = node.x
      link.targetY = node.y + 4 + (i + 0.5) * slot
      link.targetW = Math.min(slot - 1.5, RIBBON_MAX)
    })
  }
}

// A filled, tapered Sankey band between a source node's right edge and a
// target node's left edge (falls back to node centers if slots are unset).
function ribbonPath(link, from, to) {
  const x0 = link.sourceX ?? from.x + from.w
  const x1 = link.targetX ?? to.x
  const sy = link.sourceY ?? nodeCenterY(from)
  const ty = link.targetY ?? nodeCenterY(to)
  const sw = Math.max(2, link.sourceW ?? 6)
  const tw = Math.max(2, link.targetW ?? 6)
  const cx = (x0 + x1) / 2
  return [
    `M ${x0} ${sy - sw / 2}`,
    `C ${cx} ${sy - sw / 2}, ${cx} ${ty - tw / 2}, ${x1} ${ty - tw / 2}`,
    `L ${x1} ${ty + tw / 2}`,
    `C ${cx} ${ty + tw / 2}, ${cx} ${sy + sw / 2}, ${x0} ${sy + sw / 2}`,
    'Z',
  ].join(' ')
}

// A gentle center-to-center arc for the force-directed network view, where
// edges run at arbitrary angles instead of column to column.
function networkPath(from, to) {
  const x1 = from.x + from.w / 2
  const y1 = from.y + from.h / 2
  const x2 = to.x + to.w / 2
  const y2 = to.y + to.h / 2
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const bow = Math.min(28, len * 0.12)
  const mx = (x1 + x2) / 2 + (-dy / len) * bow
  const my = (y1 + y2) / 2 + (dx / len) * bow
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`
}

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NETWORK_SIZE = {
  identity: { w: 140, h: 46 },
  project: { w: 180, h: 60 },
  task: { w: 150, h: 44 },
  goal: { w: 138, h: 44 },
  decision: { w: 138, h: 44 },
}

// Deterministic force-directed layout. Runs a fixed number of settling
// iterations so the same inputs always produce the same picture.
function buildNetworkLayout({ visibleProjects, visibleIdentityNodes, visibleTaskNodes, laneNodes, dependencyLinks, viewMode }) {
  const nodes = []
  const links = []

  const pushNode = (id, type, name, color, data) => {
    const size = NETWORK_SIZE[type] || { w: 150, h: 46 }
    nodes.push({ id, type, name, color, data, w: size.w, h: size.h, x: 0, y: 0 })
  }

  visibleIdentityNodes.forEach(identity =>
    pushNode(`identity:${identity.id}`, 'identity', identity.name, identity.color, { ...identity, type: 'identity' })
  )
  visibleProjects.forEach(project =>
    pushNode(`project:${project.id}`, 'project', project.name, riskColor(project.risk), project)
  )
  visibleTaskNodes.forEach(task =>
    pushNode(`task:${task.id}`, 'task', task.name, task.color, task)
  )
  laneNodes.forEach(node => {
    if (node.lane === 'goal') pushNode(`goal:${node.id}`, 'goal', node.name, node.color, node)
    else pushNode(`decision:${node.id}`, 'decision', node.name, node.color, node)
  })

  const identityColorById = new Map(visibleIdentityNodes.map(identity => [identity.id, identity.color]))
  visibleProjects.forEach(project => {
    project.identityIds.forEach(identityId => {
      links.push({ from: `identity:${identityId}`, to: `project:${project.id}`, color: identityColorById.get(identityId) || '#64748b', type: 'owns' })
    })
  })
  visibleTaskNodes.forEach(task => {
    links.push({ from: `project:${task.projectId}`, to: `task:${task.id}`, color: viewMode === 'dependencies' ? '#737373' : riskColor(task.risk), type: task.risk })
  })
  laneNodes.forEach(node => {
    if (node.lane === 'goal') {
      (node.projectIds || []).forEach(projectId => links.push({ from: `goal:${node.id}`, to: `project:${projectId}`, color: node.color, type: 'goal' }))
    } else if (node.projectId) {
      links.push({ from: `decision:${node.id}`, to: `project:${node.projectId}`, color: node.color, type: 'decision' })
    }
  })
  if (viewMode === 'dependencies') {
    dependencyLinks.forEach(link => links.push({ from: link.from, to: link.to, color: STATUS_COLOR.failed, type: 'dependency' }))
  }

  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const validLinks = links.filter(l => nodeById.has(l.from) && nodeById.has(l.to))

  const width = 1200
  const height = 820
  const cx = width / 2
  const cy = height / 2
  const rng = mulberry32((nodes.length * 2654435761) >>> 0)
  nodes.forEach((node, i) => {
    const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2
    const radius = Math.min(width, height) * 0.34
    node.x = cx + Math.cos(angle) * radius + (rng() - 0.5) * 60
    node.y = cy + Math.sin(angle) * radius + (rng() - 0.5) * 60
    node.vx = 0
    node.vy = 0
  })

  const index = new Map(nodes.map((n, i) => [n.id, i]))
  const springLen = 150
  const springK = 0.025
  const repulse = 9000
  const gravity = 0.02
  const damping = 0.86
  for (let iter = 0; iter < 320; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[i].x - nodes[j].x
        let dy = nodes[i].y - nodes[j].y
        const d2 = dx * dx + dy * dy + 0.01
        const d = Math.sqrt(d2)
        const f = repulse / d2
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        nodes[i].vx += fx
        nodes[i].vy += fy
        nodes[j].vx -= fx
        nodes[j].vy -= fy
      }
    }
    for (const link of validLinks) {
      const a = nodes[index.get(link.from)]
      const b = nodes[index.get(link.to)]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 0.01
      const f = (d - springLen) * springK
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }
    for (const node of nodes) {
      node.vx += (cx - node.x) * gravity
      node.vy += (cy - node.y) * gravity
      node.vx *= damping
      node.vy *= damping
      node.x += node.vx
      node.y += node.vy
    }
  }

  const pad = 90
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  nodes.forEach(node => {
    node.x -= node.w / 2
    node.y -= node.h / 2
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x + node.w)
    maxY = Math.max(maxY, node.y + node.h)
  })
  if (!nodes.length) {
    minX = 0
    minY = 0
    maxX = width
    maxY = height
  }
  nodes.forEach(node => {
    node.x += pad - minX
    node.y += pad - minY
    delete node.vx
    delete node.vy
  })

  return {
    nodes,
    links: validLinks,
    nodeById,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
    columns: null,
  }
}

export default function StructureMap() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const graphRef = useRef(null)
  const panRef = useRef(null)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('all')
  const [viewMode, setViewMode] = useState('map')
  const [layoutStyle, setLayoutStyle] = useState('sankey')
  const [selected, setSelected] = useState(null)
  const [frame, setFrame] = useState({ width: 0, height: 0 })
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 })

  const { data: projects = [], isLoading } = useQuery({ queryKey: ['projects', 'structure-map'], queryFn: getProjects })
  const { data: identities = [] } = useQuery({ queryKey: ['identities', 'structure-map'], queryFn: getIdentities })
  const { data: goals = [] } = useQuery({ queryKey: ['goals', 'structure-map'], queryFn: getGoals })
  const { data: decisions = [] } = useQuery({ queryKey: ['decisions', 'structure-map'], queryFn: getDecisions })

  const graph = useMemo(
    () => deriveStructureMap(projects, identities, goals, decisions),
    [projects, identities, goals, decisions]
  )

  const search = query.trim().toLowerCase()
  const taskById = useMemo(() => {
    const tasks = [...(graph.dependencyTaskNodes || []), ...graph.taskNodes]
    return new Map(tasks.map(task => [task.id, task]))
  }, [graph.dependencyTaskNodes, graph.taskNodes])
  const projectById = useMemo(
    () => new Map(graph.projectNodes.map(project => [project.id, project])),
    [graph.projectNodes]
  )

  const projectSearchIndex = useMemo(() => {
    const identityById = new Map(graph.identityNodes.map(identity => [identity.id, identity.name]))
    const rawProjectById = new Map(projects.map(project => [project.id, project]))
    return new Map(graph.projectNodes.map(project => {
      const identityText = project.identityIds.map(id => identityById.get(id)).filter(Boolean)
      const taskText = (rawProjectById.get(project.id)?.tasks || []).map(task => task.title).filter(Boolean)
      const goalText = graph.goalNodes.filter(goal => goal.projectIds?.includes(project.id)).map(goal => goal.name)
      const decisionText = graph.decisionNodes.filter(decision => decision.projectId === project.id).map(decision => decision.name)
      return [project.id, [project.name, ...identityText, ...taskText, ...goalText, ...decisionText].join(' ').toLowerCase()]
    }))
  }, [graph, projects])

  const visibleProjects = graph.projectNodes.filter(project => {
    const matchesSearch = !search || projectSearchIndex.get(project.id)?.includes(search)
    const matchesMode =
      mode === 'all' ||
      (mode === 'risk' && (project.failed > 0 || project.overdue > 0)) ||
      (mode === 'unowned' && project.identityIds.length === 0) ||
      (mode === 'active' && project.status === 'active')
    return matchesSearch && matchesMode
  })
  const visibleProjectIds = new Set(visibleProjects.map(project => project.id))
  const visibleIdentityNodes = graph.identityNodes.filter(identity =>
    !search ||
    identity.name.toLowerCase().includes(search) ||
    visibleProjects.some(project => project.identityIds.includes(identity.id))
  )
  const sourceTaskNodes = viewMode === 'dependencies' ? graph.dependencyTaskNodes : graph.taskNodes
  const rankedTaskNodes = [...sourceTaskNodes]
    .filter(task => visibleProjectIds.has(task.projectId))
    .sort((a, b) => taskWeight(b) - taskWeight(a) || a.name.localeCompare(b.name))
  const selectedDependencyTaskIds = new Set()
  if (viewMode === 'dependencies' && selected?.type === 'task') {
    for (const taskId of dependencyNeighborhood(selected.id, graph.dependencyLinks)) {
      selectedDependencyTaskIds.add(taskId)
    }
  }
  const visibleTaskNodes = [
    ...rankedTaskNodes.slice(0, viewMode === 'dependencies' ? 28 : 18),
    ...Array.from(selectedDependencyTaskIds).map(taskId => taskById.get(taskId)).filter(Boolean),
  ].filter((task, index, tasks) =>
    visibleProjectIds.has(task.projectId) && tasks.findIndex(item => item.id === task.id) === index
  )
  const visibleTaskIds = new Set(visibleTaskNodes.map(task => task.id))
  const visibleDependencyLinks = (graph.dependencyLinks || []).filter(link =>
    visibleTaskIds.has(link.from.replace('task:', '')) && visibleTaskIds.has(link.to.replace('task:', ''))
  )
  const showDependencyNotice = visibleProjects.length > 0 && viewMode === 'dependencies' && visibleDependencyLinks.length === 0

  const laneNodes = [
    ...graph.goalNodes.map(node => ({ ...node, lane: 'goal', color: STATUS_COLOR.done })),
    ...graph.decisionNodes.map(node => ({ ...node, lane: 'decision', color: node.status === 'proposed' ? STATUS_COLOR.in_progress : STATUS_COLOR.done })),
  ].filter(node => {
    const linkedProjectIds = node.projectIds || (node.projectId ? [node.projectId] : [])
    const linkedVisible = linkedProjectIds.some(projectId => visibleProjectIds.has(projectId))
    // Network view exists to expose every non-tree relation, so keep any goal
    // or decision touching a visible project; column views stay compact.
    if (layoutStyle === 'network' && !search) return linkedVisible
    if (!search) return true
    return node.name.toLowerCase().includes(search) || linkedVisible
  }).slice(0, layoutStyle === 'network' ? 60 : 10)

  // Stable structural signature so the (potentially expensive force) layout
  // only rebuilds when the graph actually changes, not on pan/zoom/select.
  const layoutSignature = [
    layoutStyle,
    viewMode,
    visibleIdentityNodes.map(n => `${n.id}:${n.color}`).join(','),
    visibleProjects.map(n => `${n.id}:${n.risk}:${n.progress}:${n.identityIds.join('+')}`).join(','),
    visibleTaskNodes.map(n => `${n.id}:${n.status}:${n.projectId}`).join(','),
    laneNodes.map(n => `${n.lane}:${n.id}:${(n.projectIds || n.projectId || '')}`).join(','),
    visibleDependencyLinks.map(l => `${l.from}>${l.to}`).join(','),
  ].join('|')

  const mapLayout = useMemo(
    () => {
      const params = { visibleProjects, visibleIdentityNodes, visibleTaskNodes, laneNodes, dependencyLinks: visibleDependencyLinks, viewMode }
      return layoutStyle === 'network' ? buildNetworkLayout(params) : buildMindMapLayout(params)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutSignature]
  )

  useEffect(() => {
    const el = graphRef.current
    if (!el) return undefined
    const update = () => setFrame({ width: el.clientWidth, height: el.clientHeight })
    update()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const fit = useMemo(() => {
    const padding = 28
    if (!frame.width || !frame.height) return { scale: 1, x: 0, y: 0 }
    const scale = Math.max(0.2, Math.min(
      1,
      (frame.width - padding) / mapLayout.width,
      (frame.height - padding) / mapLayout.height
    ))
    return {
      scale,
      x: Math.max(0, (frame.width - mapLayout.width * scale) / 2),
      y: Math.max(0, (frame.height - mapLayout.height * scale) / 2),
    }
  }, [frame.height, frame.width, mapLayout.height, mapLayout.width])

  useEffect(() => {
    setView({ zoom: 1, x: 0, y: 0 })
  }, [mapLayout.width, mapLayout.height, mode, query, viewMode, layoutStyle])

  useEffect(() => {
    if (!selected) return
    const key = nodeDataKey(selected)
    if (key && !mapLayout.nodeById.has(key)) setSelected(null)
  }, [mapLayout.nodeById, selected])

  const transform = {
    scale: fit.scale * view.zoom,
    x: fit.x + view.x,
    y: fit.y + view.y,
  }

  const selectedNodeKey = nodeDataKey(selected)
  const relatedNodeKeys = useMemo(() => {
    if (!selectedNodeKey) return new Set()
    if (layoutStyle === 'network') {
      // General graph: highlight the node and its direct neighbours.
      const keys = new Set([selectedNodeKey])
      for (const link of mapLayout.links) {
        if (link.from === selectedNodeKey) keys.add(link.to)
        if (link.to === selectedNodeKey) keys.add(link.from)
      }
      return keys
    }
    if (viewMode === 'dependencies' && selected?.type === 'task') {
      const keys = new Set([selectedNodeKey, `project:${selected.projectId}`])
      const visit = (key) => {
        for (const link of mapLayout.links) {
          if (link.type !== 'dependency') continue
          if (link.from === key && !keys.has(link.to)) {
            keys.add(link.to)
            visit(link.to)
          }
          if (link.to === key && !keys.has(link.from)) {
            keys.add(link.from)
            visit(link.from)
          }
        }
      }
      visit(selectedNodeKey)
      return keys
    }
    // Follow the identity -> project -> task hierarchy up (ancestors) and
    // down (descendants) so selecting a node focuses its whole chain.
    const children = new Map()
    const parents = new Map()
    for (const link of mapLayout.links) {
      if (!link.flow) continue
      if (!children.has(link.from)) children.set(link.from, [])
      if (!parents.has(link.to)) parents.set(link.to, [])
      children.get(link.from).push(link.to)
      parents.get(link.to).push(link.from)
    }
    const keys = new Set([selectedNodeKey])
    const walk = (start, adjacency) => {
      const stack = [start]
      while (stack.length) {
        const key = stack.pop()
        for (const next of adjacency.get(key) || []) {
          if (!keys.has(next)) {
            keys.add(next)
            stack.push(next)
          }
        }
      }
    }
    walk(selectedNodeKey, children)
    walk(selectedNodeKey, parents)
    // Pull in goal/decision accents attached to any highlighted project.
    for (const link of mapLayout.links) {
      if (link.flow) continue
      if (keys.has(link.from) || keys.has(link.to)) {
        keys.add(link.from)
        keys.add(link.to)
      }
    }
    return keys
  }, [mapLayout.links, selected, selectedNodeKey, viewMode, layoutStyle])

  const shouldMute = (node) => {
    if (!selected) return false
    return !relatedNodeKeys.has(nodeDataKey(node))
  }

  const isLinkMuted = (link) => {
    if (!selected) return false
    return !relatedNodeKeys.has(link.from) || !relatedNodeKeys.has(link.to)
  }

  const jumpTo = (node) => {
    if (!node) return
    switch (node.type) {
      case 'project':
        navigate(`/projects/${node.id}`)
        break
      case 'task':
        if (node.projectId) navigate(`/projects/${node.projectId}`)
        break
      case 'identity':
        navigate('/identities')
        break
      case 'goal':
        navigate('/goals')
        break
      case 'decision':
        navigate('/decisions')
        break
      default:
        break
    }
  }

  const zoomBy = (delta) => {
    setView(current => ({ ...current, zoom: Math.max(0.65, Math.min(2.4, current.zoom + delta)) }))
  }

  const resetView = () => {
    setView({ zoom: 1, x: 0, y: 0 })
  }

  const panBy = (dx, dy) => {
    setView(current => ({
      ...current,
      x: current.x + dx,
      y: current.y + dy,
    }))
  }

  const clearFilters = () => {
    setQuery('')
    setMode('all')
  }

  const handleGraphKeyDown = (event) => {
    const step = event.shiftKey ? 120 : 48
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      panBy(step, 0)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      panBy(-step, 0)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      panBy(0, step)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      panBy(0, -step)
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      zoomBy(0.14)
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      zoomBy(-0.14)
    } else if (event.key === '0') {
      event.preventDefault()
      resetView()
    }
  }

  const startPan = (event) => {
    if ((event.button !== undefined && event.button !== 0) || event.target.closest('.kt-map-node, .kt-map-empty button')) return
    panRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      view,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.currentTarget.classList.add('is-panning')
    event.preventDefault()
  }

  const movePan = (event) => {
    const pan = panRef.current
    if (!pan) return
    if (pan.pointerId !== undefined && event.pointerId !== pan.pointerId) return
    setView(current => ({
      ...current,
      x: pan.view.x + event.clientX - pan.x,
      y: pan.view.y + event.clientY - pan.y,
    }))
  }

  const endPan = (event) => {
    const pan = panRef.current
    if (!pan) {
      event.currentTarget.classList.remove('is-panning')
      return
    }
    if (pan?.pointerId !== undefined && event.pointerId !== undefined && event.pointerId !== pan.pointerId) return
    if (pan.pointerId !== undefined && event.currentTarget.hasPointerCapture?.(pan.pointerId)) {
      event.currentTarget.releasePointerCapture?.(pan.pointerId)
    }
    panRef.current = null
    event.currentTarget.classList.remove('is-panning')
  }

  const zoomMap = (event) => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const nextZoom = Math.max(0.65, Math.min(2.4, view.zoom * (event.deltaY > 0 ? 0.92 : 1.08)))
    const currentScale = fit.scale * view.zoom
    const nextScale = fit.scale * nextZoom
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top
    const canvasX = (px - transform.x) / currentScale
    const canvasY = (py - transform.y) / currentScale
    setView({
      zoom: nextZoom,
      x: px - fit.x - canvasX * nextScale,
      y: py - fit.y - canvasY * nextScale,
    })
  }

  if (isLoading) return <p className="kt-muted" style={{ padding: 24 }}>{t('loading')}</p>

  return (
    <div className="kt-page kt-map-page">
      <div className="kt-page-header">
        <div className="kt-page-heading">
          <h1 className="kt-page-title">{t('structure.title')}</h1>
          <p className="kt-page-subtitle">{t('structure.subtitle')}</p>
        </div>
      </div>

      <div className="kt-map-toolbar">
        <label className="kt-map-search">
          <Search size={14} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('structure.search')} />
        </label>
        <div className="kt-map-segment" aria-label={t('structure.styleMode')}>
          {STYLE_MODES.map(key => (
            <button key={key} type="button" onClick={() => setLayoutStyle(key)} className={layoutStyle === key ? 'is-active' : ''}>
              {t(`structure.style.${key}`)}
            </button>
          ))}
        </div>
        <div className="kt-map-segment" aria-label={t('structure.viewMode')}>
          {VIEW_MODES.map(key => (
            <button key={key} type="button" onClick={() => setViewMode(key)} className={viewMode === key ? 'is-active' : ''}>
              {t(`structure.view.${key}`)}
            </button>
          ))}
        </div>
        {FILTERS.map(key => (
          <button key={key} onClick={() => setMode(key)} className={mode === key ? 'is-active' : ''}>
            {t(`structure.filter.${key}`)}
          </button>
        ))}
        <div className="kt-map-controls" aria-label={t('structure.viewControls')}>
          <button type="button" onClick={() => zoomBy(0.14)} title={t('structure.zoomIn')} aria-label={t('structure.zoomIn')}>
            <Plus size={14} />
          </button>
          <button type="button" onClick={() => zoomBy(-0.14)} title={t('structure.zoomOut')} aria-label={t('structure.zoomOut')}>
            <Minus size={14} />
          </button>
          <button type="button" onClick={resetView} title={t('structure.fitView')} aria-label={t('structure.fitView')}>
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      <div className="kt-map-stats">
        <Stat label={t('structure.identities')} value={graph.stats.identities} />
        <Stat label={t('structure.projects')} value={graph.stats.projects} />
        <Stat label={t('structure.signalTasks')} value={graph.stats.tasks} />
        <Stat label={t('structure.risk')} value={graph.stats.failedProjects + graph.stats.overdueProjects} color={STATUS_COLOR.failed} />
        <Stat label={t('structure.unowned')} value={graph.stats.unownedProjects} color={STATUS_COLOR.todo} />
        <Stat label={t('structure.dependencies')} value={graph.stats.dependencies || 0} color={STATUS_COLOR.failed} />
      </div>

      <div className="kt-map-legend" aria-label={t('structure.legend')}>
        <span><i className="is-ownership" />{t('structure.legend.ownership')}</span>
        <span><i className="is-signal" />{t('structure.legend.signal')}</span>
        <span><i className="is-dependency" />{t('structure.legend.dependency')}</span>
      </div>
      {showDependencyNotice && (
        <div className="kt-map-notice">
          <strong>{t('structure.noDependencies')}</strong>
          <span>{t('structure.noDependenciesHint')}</span>
        </div>
      )}

      {projects.length === 0 ? (
        <EmptyState message={t('dashboard.noProjectsEmpty')} hint={t('dashboard.createFirstProject')} />
      ) : (
        <div className="kt-map-surface">
          <div
            ref={graphRef}
            className="kt-map-graph"
            role="region"
            aria-label={t('structure.graphLabel')}
            tabIndex={0}
            onKeyDown={handleGraphKeyDown}
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            onLostPointerCapture={endPan}
            onWheel={zoomMap}
          >
            <div
              className="kt-map-canvas"
              style={{
                width: mapLayout.width,
                height: mapLayout.height,
                transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              }}
            >
              <svg className="kt-map-links" viewBox={`0 0 ${mapLayout.width} ${mapLayout.height}`} aria-hidden="true">
                {mapLayout.links.map((link, index) => {
                  const from = mapLayout.nodeById.get(link.from)
                  const to = mapLayout.nodeById.get(link.to)
                  const muted = isLinkMuted(link)
                  if (layoutStyle === 'sankey' && link.flow) {
                    return (
                      <path
                        key={`${link.from}-${link.to}-${index}`}
                        className={['kt-ribbon', `is-${link.type}`, muted ? 'is-muted' : ''].filter(Boolean).join(' ')}
                        d={ribbonPath(link, from, to)}
                        fill={link.color}
                        stroke="none"
                      />
                    )
                  }
                  const d = layoutStyle === 'network' ? networkPath(from, to) : computePath(from, to, link.type)
                  const dependencyDash = link.type === 'dependency' ? '1.75 1.75' : undefined
                  return (
                    <path
                      key={`${link.from}-${link.to}-${index}`}
                      className={[`is-${link.type}`, muted ? 'is-muted' : ''].filter(Boolean).join(' ')}
                      d={d}
                      stroke={link.color}
                      strokeWidth={link.type === 'goal' || link.type === 'decision' ? 1.6 : 1.35}
                      strokeDasharray={dependencyDash}
                      style={dependencyDash ? { '--kt-map-dash': dependencyDash, strokeDasharray: dependencyDash } : undefined}
                      fill="none"
                      strokeLinecap="round"
                    />
                  )
                })}
              </svg>

              {mapLayout.columns && (
                <>
                  <div className="kt-map-col-label" style={{ left: mapLayout.columns.identity.x, top: mapLayout.padY || 6, width: mapLayout.columns.identity.w }}>
                    {t('structure.identities')}
                  </div>
                  <div className="kt-map-col-label" style={{ left: mapLayout.columns.project.x, top: mapLayout.padY || 6, width: mapLayout.columns.project.w }}>
                    {t('structure.projects')}
                  </div>
                  <div className="kt-map-col-label" style={{ left: mapLayout.columns.task.x, top: mapLayout.padY || 6, width: mapLayout.columns.task.w }}>
                    {t('structure.signalTasks')}
                  </div>
                </>
              )}

              {mapLayout.nodes.map(node => (
                <GraphNode
                  key={node.id}
                  color={node.color}
                  active={selectedNodeKey === node.id}
                  muted={shouldMute(node.data)}
                  label={`${node.name} · ${node.data.status || node.data.risk || node.type} — ${t('structure.doubleClickOpen')}`}
                  onClick={() => setSelected(node.data)}
                  onDoubleClick={() => jumpTo(node.data)}
                  className={`is-${node.type}`}
                  style={{ left: node.x, top: node.y, width: node.w, minHeight: node.h }}
                >
                  {node.type === 'identity' && (
                    node.data.avatar
                      ? <span className="kt-map-avatar">{node.data.avatar}</span>
                      : <UserRound size={13} />
                  )}
                  {node.type === 'goal' && <Target size={13} />}
                  {node.type === 'decision' && <GitFork size={13} />}
                  {node.type === 'project' && <Network size={13} />}
                  {node.type === 'task' && <AlertTriangle size={13} />}
                  <strong>{node.name}</strong>
                  {node.type === 'identity' && <em>{node.data.projectCount} {t('structure.projects')}</em>}
                  {node.type === 'project' && (
                    <>
                      <span className="kt-map-progress"><i style={{ width: `${node.data.progress}%` }} /></span>
                      <em>{node.data.doneTasks}/{node.data.totalTasks} {t('done')} · {node.data.pendingDecisionCount} {t('pending')}</em>
                      {(node.data.failed > 0 || node.data.overdue > 0) && <b><AlertTriangle size={11} /> {node.data.failed + node.data.overdue}</b>}
                    </>
                  )}
                  {node.type === 'task' && (
                    <>
                      <em>{node.data.status} · {node.data.priority}</em>
                      {viewMode === 'dependencies' && (node.data.blockedBy?.length > 0 || node.data.blocking?.length > 0) && (
                        <em>{node.data.blockedBy?.length || 0} {t('structure.dependsOn')} · {node.data.blocking?.length || 0} {t('structure.blocks')}</em>
                      )}
                      <span className={`kt-map-risk is-${node.data.risk}`}>{node.data.risk}</span>
                    </>
                  )}
                  {(node.type === 'goal' || node.type === 'decision') && <em>{node.data.status}</em>}
                </GraphNode>
              ))}
              {visibleProjects.length === 0 && (
                <div className="kt-map-empty">
                  <strong>{t('structure.noMatches')}</strong>
                  <span>{t('structure.noMatchesHint')}</span>
                  <button type="button" onClick={clearFilters}>{t('structure.clearFilters')}</button>
                </div>
              )}
            </div>
          </div>

          <aside className="kt-map-inspector">
            {selected ? (
              <>
                <span>{selected.type || selected.lane}</span>
                <h2>{selected.name}</h2>
                <p>{selected.status || selected.risk || t('active')}</p>
                {hasInspectorMetrics(selected) && (
                  <div className="kt-map-inspector-metrics">
                    {selected.type === 'project' && (
                      <>
                        <div><b>{selected.progress}%</b><span>{t('structure.progress')}</span></div>
                        <div><b>{selected.failed + selected.overdue}</b><span>{t('structure.risk')}</span></div>
                        <div><b>{selected.pendingDecisionCount}</b><span>{t('pending')}</span></div>
                        <div><b>{selected.dependencyCount || 0}</b><span>{t('structure.dependencies')}</span></div>
                      </>
                    )}
                    {selected.type === 'identity' && (
                      <>
                        <div><b>{selected.projectCount}</b><span>{t('structure.projects')}</span></div>
                        <div><b>{selected.shareActive ? t('active') : t('inactive')}</b><span>{t('structure.share')}</span></div>
                      </>
                    )}
                    {selected.type === 'task' && (
                      <>
                        <div><b>{selected.priority || '-'}</b><span>{t('priority')}</span></div>
                        <div><b>{selected.risk}</b><span>{t('structure.risk')}</span></div>
                        <div><b>{selected.assignee || '-'}</b><span>{t('assignee')}</span></div>
                      </>
                    )}
                    {selected.type === 'goal' && (
                      <>
                        <div><b>{selected.progress}%</b><span>{t('structure.progress')}</span></div>
                        <div><b>{selected.projectIds?.length || 0}</b><span>{t('structure.projects')}</span></div>
                      </>
                    )}
                    {selected.type === 'decision' && (
                      <div><b>{selected.status}</b><span>{t('structure.decisionState')}</span></div>
                    )}
                  </div>
                )}
                {selected.type === 'task' && (
                  <div className="kt-map-dependencies">
                    <div>
                      <strong>{t('structure.dependsOn')}</strong>
                      {(selected.blockedBy || []).length === 0 ? (
                        <span>{t('deps.noBlockers')}</span>
                      ) : (
                        selected.blockedBy.map(taskId => {
                          const task = taskById.get(taskId)
                          return (
                            <button key={taskId} type="button" onClick={() => task && setSelected(task)}>
                              {task?.name || taskId.slice(-8)}
                            </button>
                          )
                        })
                      )}
                    </div>
                    <div>
                      <strong>{t('structure.blocks')}</strong>
                      {(selected.blocking || []).length === 0 ? (
                        <span>{t('structure.noBlocking')}</span>
                      ) : (
                        selected.blocking.map(taskId => {
                          const task = taskById.get(taskId)
                          return (
                            <button key={taskId} type="button" onClick={() => task && setSelected(task)}>
                              {task?.name || taskId.slice(-8)}
                            </button>
                          )
                        })
                      )}
                    </div>
                  </div>
                )}
                {selected.type === 'goal' && (selected.projectIds || []).length > 0 && (
                  <div className="kt-map-dependencies">
                    <div>
                      <strong>{t('structure.linkedProjects')}</strong>
                      {selected.projectIds.map(projectId => {
                        const project = projectById.get(projectId)
                        return (
                          <button key={projectId} type="button" onClick={() => navigate(`/projects/${projectId}`)}>
                            {project?.name || projectId.slice(-8)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                {selected.type === 'identity' && (selected.projectIds || []).length > 0 && (
                  <div className="kt-map-dependencies">
                    <div>
                      <strong>{t('structure.linkedProjects')}</strong>
                      {selected.projectIds.map(projectId => {
                        const project = projectById.get(projectId)
                        return (
                          <button key={projectId} type="button" onClick={() => navigate(`/projects/${projectId}`)}>
                            {project?.name || projectId.slice(-8)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                {['project', 'task', 'identity', 'goal', 'decision'].includes(selected.type) && (
                  <button className="kt-map-open" onClick={() => jumpTo(selected)}>
                    {t(`structure.open.${selected.type}`)}
                  </button>
                )}
                <button onClick={() => setSelected(null)}>{t('clear')}</button>
              </>
            ) : (
              <>
                <span>{t('structure.inspector')}</span>
                <h2>{t('structure.selectNode')}</h2>
                <p>{t('structure.selectHint')}</p>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
