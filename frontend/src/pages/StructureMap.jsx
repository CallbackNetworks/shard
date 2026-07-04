import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, GitFork, Maximize2, Minus, Network, Plus, Search, Target, UserRound } from 'lucide-react'
import { getDecisions, getGoals, getIdentities, getProjects } from '../api/client'
import { STATUS_COLOR } from '../constants/theme'
import { dependencyNeighborhood, deriveStructureMap } from '../utils/structureMap'
import EmptyState from '../components/shared/EmptyState'

const CANVAS_W = 1680
const FILTERS = ['all', 'active', 'risk', 'unowned']
const VIEW_MODES = ['map', 'dependencies']

function riskColor(risk) {
  if (risk === 'failed' || risk === 'overdue') return STATUS_COLOR.failed
  if (risk === 'active' || risk === 'priority') return STATUS_COLOR.in_progress
  return STATUS_COLOR.todo
}

function spread(index, total, min, max) {
  if (total <= 1) return (min + max) / 2
  return min + ((max - min) / (total - 1)) * index
}

function laneY(index, start, gap) {
  return start + index * gap
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

function GraphNode({ children, active, muted, color, label, onClick, className = '', style }) {
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
    >
      {children}
    </button>
  )
}

function buildMindMapLayout({ visibleProjects, visibleIdentityNodes, visibleTaskNodes, laneNodes, dependencyLinks, viewMode, t }) {
  const topBand = 104
  const bottomBand = 104
  const projectGap = 116
  const taskGap = 86
  const identityGap = 86
  const bodyHeight = Math.max(
    520,
    Math.max(visibleProjects.length, 1) * projectGap,
    Math.max(visibleTaskNodes.length, 1) * taskGap,
    Math.max(visibleIdentityNodes.length, 1) * identityGap
  )
  const canvasH = topBand + bodyHeight + bottomBand
  const bodyTop = topBand
  const bodyBottom = topBand + bodyHeight - 92
  const rootY = topBand + bodyHeight / 2 - 43

  const nodes = [{
    id: 'root:structure',
    type: 'root',
    name: t('structure.title'),
    x: 745,
    y: rootY,
    w: 190,
    h: 86,
    color: STATUS_COLOR.in_progress,
    data: { id: 'root:structure', type: 'root', name: t('structure.title'), status: t('structure.liveMap') },
  }]
  const links = []

  visibleProjects.forEach((project, index) => {
    const x = 620 + (index % 2) * 280
    const y = spread(index, visibleProjects.length, bodyTop + 16, bodyBottom)
    nodes.push({
      id: `project:${project.id}`,
      type: 'project',
      name: project.name,
      x,
      y,
      w: 220,
      h: 82,
      color: riskColor(project.risk),
      data: project,
    })
    links.push({ from: 'root:structure', to: `project:${project.id}`, color: riskColor(project.risk), type: 'root' })
  })

  visibleIdentityNodes.forEach((identity, index) => {
    nodes.push({
      id: `identity:${identity.id}`,
      type: 'identity',
      name: identity.name,
      x: 96 + (index % 2) * 132,
      y: spread(index, visibleIdentityNodes.length, bodyTop + 28, bodyBottom),
      w: 156,
      h: 62,
      color: identity.color,
      data: { ...identity, type: 'identity' },
    })
  })

  visibleProjects.forEach(project => {
    project.identityIds.forEach(identityId => {
      links.push({
        from: `identity:${identityId}`,
        to: `project:${project.id}`,
        color: '#525252',
        type: 'owns',
      })
    })
  })

  visibleTaskNodes.forEach((task, index) => {
    nodes.push({
      id: `task:${task.id}`,
      type: 'task',
      name: task.name,
      x: 1240 + (index % 2) * 132,
      y: laneY(index, bodyTop + 4, taskGap),
      w: 200,
      h: 66,
      color: task.color,
      data: task,
    })
    links.push({
      from: `project:${task.projectId}`,
      to: `task:${task.id}`,
      color: viewMode === 'dependencies' ? '#737373' : riskColor(task.risk),
      type: task.risk,
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

  const goalNodes = laneNodes.filter(node => node.lane === 'goal')
  const decisionNodes = laneNodes.filter(node => node.lane === 'decision')

  goalNodes.forEach((goal, index) => {
    nodes.push({
      id: `goal:${goal.id}`,
      type: 'goal',
      name: goal.name,
      x: 360 + (index % 5) * 220,
      y: 24 + Math.floor(index / 5) * 58,
      w: 142,
      h: 54,
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

  decisionNodes.forEach((decision, index) => {
    nodes.push({
      id: `decision:${decision.id}`,
      type: 'decision',
      name: decision.name,
      x: 360 + (index % 5) * 220,
      y: canvasH - 78 - Math.floor(index / 5) * 58,
      w: 138,
      h: 54,
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

  const nodeById = new Map(nodes.map(node => [node.id, node]))
  return {
    nodes,
    links: links.filter(link => nodeById.has(link.from) && nodeById.has(link.to)),
    nodeById,
    width: CANVAS_W,
    height: canvasH,
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
  const selectedProjectId = selected?.type === 'project' ? selected.id : selected?.projectId
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
    if (!search) return true
    const linkedProjectIds = node.projectIds || (node.projectId ? [node.projectId] : [])
    return node.name.toLowerCase().includes(search) || linkedProjectIds.some(projectId => visibleProjectIds.has(projectId))
  }).slice(0, 10)

  const mapLayout = useMemo(
    () => buildMindMapLayout({ visibleProjects, visibleIdentityNodes, visibleTaskNodes, laneNodes, dependencyLinks: visibleDependencyLinks, viewMode, t }),
    [visibleProjects, visibleIdentityNodes, visibleTaskNodes, laneNodes, visibleDependencyLinks, viewMode, t]
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
  }, [mapLayout.width, mapLayout.height, mode, query, viewMode])

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
    if (selectedNodeKey === 'root:structure') return new Set(mapLayout.nodes.map(node => node.id))
    if (viewMode === 'dependencies' && selected?.type === 'task') {
      const keys = new Set(['root:structure', selectedNodeKey, `project:${selected.projectId}`])
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
    const sourceKeys = new Set([selectedNodeKey])
    if (selectedProjectId) sourceKeys.add(`project:${selectedProjectId}`)
    const keys = new Set(['root:structure', ...sourceKeys])
    for (const link of mapLayout.links) {
      if (sourceKeys.has(link.from) || sourceKeys.has(link.to)) {
        keys.add(link.from)
        keys.add(link.to)
      }
    }
    return keys
  }, [mapLayout.links, mapLayout.nodes, selected, selectedNodeKey, selectedProjectId, viewMode])

  const shouldMute = (node) => {
    if (!selected) return false
    return !relatedNodeKeys.has(nodeDataKey(node))
  }

  const isLinkMuted = (link) => {
    if (!selected) return false
    return !relatedNodeKeys.has(link.from) || !relatedNodeKeys.has(link.to)
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
                  const x1 = from.x + from.w / 2
                  const y1 = from.y + from.h / 2
                  const x2 = to.x + to.w / 2
                  const y2 = to.y + to.h / 2
                  const bend = Math.max(70, Math.abs(x2 - x1) * 0.42)
                  const direction = x2 >= x1 ? 1 : -1
                  const dependencyDash = link.type === 'dependency'
                    ? '1.75 1.75'
                    : undefined
                  return (
                <path
                  key={`${link.from}-${link.to}-${index}`}
                  className={[
                    `is-${link.type}`,
                    isLinkMuted(link) ? 'is-muted' : '',
                  ].filter(Boolean).join(' ')}
                  d={`M ${x1} ${y1} C ${x1 + direction * bend} ${y1}, ${x2 - direction * bend} ${y2}, ${x2} ${y2}`}
                  stroke={link.color}
                  strokeWidth={link.type === 'root' ? 2.4 : 1.35}
                  strokeDasharray={dependencyDash}
                  style={dependencyDash ? { '--kt-map-dash': dependencyDash, strokeDasharray: dependencyDash } : undefined}
                  fill="none"
                  strokeLinecap="round"
                />
                  )
                })}
              </svg>

              {mapLayout.nodes.map(node => (
                <GraphNode
                  key={node.id}
                  color={node.color}
                  active={selectedNodeKey === node.id}
                  muted={shouldMute(node.data)}
                  label={`${node.name} · ${node.data.status || node.data.risk || node.type}`}
                  onClick={() => setSelected(node.data)}
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
                  {node.type === 'root' && <em>{graph.stats.projects} {t('structure.projects')} · {graph.stats.identities} {t('structure.identities')}</em>}
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
                {selectedProjectId && (
                  <button onClick={() => navigate(`/projects/${selectedProjectId}`)}>
                    {t('structure.openProject')}
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
