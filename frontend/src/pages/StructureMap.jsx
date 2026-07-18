import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Maximize2, Minus, Plus, Search } from 'lucide-react'
import { getGraphMap, getNodeTypes, getEdgeTypes } from '../api/client'
import { STATUS_COLOR } from '../constants/theme'
import { useIdentityFocus } from '../context/IdentityFocusContext'
import { dependencyNeighborhood } from '../utils/structureMap'
import { deriveGraphStructure, focusGraph } from '../utils/graphStructure'
import { buildMindMapLayout, buildNetworkLayout, taskWeight } from '../utils/structureMapLayout'
import { buildTerritoryModel } from '../utils/territoryModel'
import useMapViewport from '../hooks/useMapViewport'
import MapCanvas from '../components/structure/MapCanvas'
import MapInspector from '../components/structure/MapInspector'
import TerritoryCanvas from '../components/structure/TerritoryCanvas'
import EmptyState from '../components/shared/EmptyState'

const FILTERS = ['all', 'active', 'risk', 'unowned']
const VIEW_MODES = ['map', 'dependencies']
const STYLE_MODES = ['territory', 'sankey', 'lines', 'network']

function nodeDataKey(node) {
  if (!node) return null
  return node.type === 'root' ? node.id : `${node.type}:${node.id}`
}

function Stat({ label, value, color }) {
  return (
    <div className="kt-map-stat" style={{ '--map-color': color || STATUS_COLOR.in_progress }}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}

export default function StructureMap() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('all')
  const [viewMode, setViewMode] = useState('map')
  const [layoutStyle, setLayoutStyle] = useState('territory')
  const [selected, setSelected] = useState(null)
  const isTerritory = layoutStyle === 'territory'

  const { focusId } = useIdentityFocus()
  // Real graph slice (ADR-0037): the map derives everything — containers,
  // task roles, ownership, dependencies, custom types — from nodes + edges
  // plus the type registries. Roles come from the registry, not entity kinds.
  const { data: slice, isLoading } = useQuery({
    queryKey: ['graph-map', 'structure'],
    queryFn: () => getGraphMap({ includeData: true }),
  })
  const { data: nodeTypes = [] } = useQuery({ queryKey: ['node-types'], queryFn: getNodeTypes, staleTime: 300000 })
  const { data: edgeTypes = [] } = useQuery({ queryKey: ['edge-types'], queryFn: getEdgeTypes, staleTime: 300000 })

  const fullGraph = useMemo(
    () => deriveGraphStructure(slice, nodeTypes, edgeTypes),
    [slice, nodeTypes, edgeTypes]
  )
  const graph = useMemo(() => focusGraph(fullGraph, focusId), [fullGraph, focusId])
  const projects = graph.projectNodes

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
    const tasksByContainer = new Map()
    for (const task of graph.allTaskNodes || []) {
      if (!tasksByContainer.has(task.projectId)) tasksByContainer.set(task.projectId, [])
      tasksByContainer.get(task.projectId).push(task.name)
    }
    return new Map(graph.projectNodes.map(project => {
      const identityText = project.identityIds.map(id => identityById.get(id)).filter(Boolean)
      const taskText = (tasksByContainer.get(project.id) || []).filter(Boolean)
      const goalText = graph.goalNodes.filter(goal => goal.projectIds?.includes(project.id)).map(goal => goal.name)
      const decisionText = graph.decisionNodes.filter(decision => decision.projectId === project.id).map(decision => decision.name)
      return [project.id, [project.name, project.typeLabel, ...identityText, ...taskText, ...goalText, ...decisionText].join(' ').toLowerCase()]
    }))
  }, [graph])

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
  const showDependencyNotice = !isTerritory && visibleProjects.length > 0 && viewMode === 'dependencies' && visibleDependencyLinks.length === 0

  // Territory view shows every signal/dependency task inside its project card,
  // so it works from the uncapped task set instead of the ranked slice above.
  const territoryTaskNodes = (graph.dependencyTaskNodes || []).filter(task => visibleProjectIds.has(task.projectId))
  const territoryTaskIds = new Set(territoryTaskNodes.map(task => task.id))
  const territoryDependencyLinks = (graph.dependencyLinks || []).filter(link =>
    territoryTaskIds.has(link.from.replace('task:', '')) && territoryTaskIds.has(link.to.replace('task:', ''))
  )
  const territorySignature = [
    visibleIdentityNodes.map(n => `${n.id}:${n.color}:${n.name}`).join(','),
    visibleProjects.map(n => `${n.id}:${n.risk}:${n.progress}:${n.doneTasks}:${n.identityIds.join('+')}`).join(','),
    territoryTaskNodes.map(n => `${n.id}:${n.status}:${n.risk}`).join(','),
    graph.goalNodes.map(n => `${n.id}:${n.progress}:${(n.projectIds || []).join('+')}`).join(','),
    graph.decisionNodes.map(n => `${n.id}:${n.status}:${n.projectId}`).join(','),
  ].join('|')
  const territoryModel = useMemo(
    () => buildTerritoryModel({
      projects: visibleProjects,
      identities: visibleIdentityNodes,
      tasks: territoryTaskNodes,
      goals: graph.goalNodes,
      decisions: graph.decisionNodes,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [territorySignature]
  )

  const laneNodes = [
    ...graph.goalNodes.map(node => ({ ...node, lane: 'goal', color: STATUS_COLOR.done })),
    ...graph.decisionNodes.map(node => ({ ...node, lane: 'decision', color: node.status === 'proposed' ? STATUS_COLOR.in_progress : STATUS_COLOR.done })),
  ].filter(node => {
    const linkedProjectIds = node.projectIds || (node.projectId ? [node.projectId] : [])
    const linkedVisible = linkedProjectIds.some(projectId => visibleProjectIds.has(projectId))
    // The network view stays readable by showing only linked goals and still
    // undecided decisions; settled decisions are noise there.
    if (layoutStyle === 'network' && node.lane === 'decision' && node.status !== 'proposed') return false
    if (layoutStyle === 'network' && !search) return linkedVisible
    if (!search) return true
    return node.name.toLowerCase().includes(search) || linkedVisible
  }).slice(0, layoutStyle === 'network' ? 18 : 12)

  // Custom plain nodes and custom-relation edges surface in the network view
  // (ADR-0037); they follow their container's visibility and match search.
  const visibleCustomNodes = (graph.customNodes || []).filter(node => {
    if (search && !(`${node.name} ${node.typeLabel}`.toLowerCase().includes(search))) {
      return node.parentProjectId && visibleProjectIds.has(node.parentProjectId)
    }
    if (!node.parentProjectId) return true
    return visibleProjectIds.has(node.parentProjectId)
  })
  const visibleCustomLinks = graph.customLinks || []

  // Stable structural signature so the (potentially expensive force) layout
  // only rebuilds when the graph actually changes, not on pan/zoom/select.
  const layoutSignature = [
    layoutStyle,
    viewMode,
    visibleIdentityNodes.map(n => `${n.id}:${n.color}`).join(','),
    visibleProjects.map(n => `${n.id}:${n.risk}:${n.progress}:${n.identityIds.join('+')}:${n.parentContainerId || ''}`).join(','),
    visibleTaskNodes.map(n => `${n.id}:${n.status}:${n.projectId}`).join(','),
    laneNodes.map(n => `${n.lane}:${n.id}:${(n.projectIds || n.projectId || '')}`).join(','),
    visibleCustomNodes.map(n => `${n.id}:${n.parentProjectId || ''}`).join(','),
    visibleCustomLinks.map(l => `${l.from}>${l.to}:${l.relType}`).join(','),
    visibleDependencyLinks.map(l => `${l.from}>${l.to}`).join(','),
  ].join('|')

  const mapLayout = useMemo(
    () => {
      if (layoutStyle === 'territory') {
        return { nodes: [], links: [], nodeById: new Map(), width: 960, height: 600, columns: null }
      }
      const params = { visibleProjects, visibleIdentityNodes, visibleTaskNodes, laneNodes, dependencyLinks: visibleDependencyLinks, viewMode }
      if (layoutStyle === 'network') {
        return buildNetworkLayout({ ...params, customNodes: visibleCustomNodes, customLinks: visibleCustomLinks })
      }
      return buildMindMapLayout(params)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutSignature]
  )

  const {
    graphRef,
    transform,
    zoomBy,
    resetView,
    handleGraphKeyDown,
    startPan,
    movePan,
    endPan,
    zoomMap,
  } = useMapViewport({ width: mapLayout.width, height: mapLayout.height })

  useEffect(() => {
    resetView()
  }, [mapLayout.width, mapLayout.height, mode, query, viewMode, layoutStyle, resetView])

  useEffect(() => {
    if (!selected) return
    const key = nodeDataKey(selected)
    if (!key) return
    const exists = isTerritory ? territoryModel.keys.has(key) : mapLayout.nodeById.has(key)
    if (!exists) setSelected(null)
  }, [mapLayout.nodeById, territoryModel, isTerritory, selected])

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

  const containerHref = (containerId) => {
    const container = projectById.get(containerId)
    if (!container) return null
    return container.isCustomType ? `/c/${container.id}` : `/projects/${container.id}`
  }

  const jumpTo = (node) => {
    if (!node) return
    switch (node.type) {
      case 'project': {
        const href = containerHref(node.id)
        if (href) navigate(href)
        break
      }
      case 'task': {
        const href = node.projectId && containerHref(node.projectId)
        if (href) navigate(href)
        break
      }
      case 'identity':
        navigate('/identities')
        break
      case 'goal':
        navigate('/goals')
        break
      case 'decision':
        navigate('/decisions')
        break
      case 'custom':
        navigate(`/n/${node.id}`)
        break
      default:
        break
    }
  }

  const clearFilters = () => {
    setQuery('')
    setMode('all')
  }

  if (isLoading || nodeTypes.length === 0 || edgeTypes.length === 0) {
    return <p className="kt-muted" style={{ padding: 24 }}>{t('loading')}</p>
  }

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
        {!isTerritory && (
          <div className="kt-map-segment" aria-label={t('structure.viewMode')}>
            {VIEW_MODES.map(key => (
              <button key={key} type="button" onClick={() => setViewMode(key)} className={viewMode === key ? 'is-active' : ''}>
                {t(`structure.view.${key}`)}
              </button>
            ))}
          </div>
        )}
        {FILTERS.map(key => (
          <button key={key} onClick={() => setMode(key)} className={mode === key ? 'is-active' : ''}>
            {t(`structure.filter.${key}`)}
          </button>
        ))}
        {!isTerritory && (
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
        )}
      </div>

      <div className="kt-map-stats">
        <Stat label={t('structure.identities')} value={graph.stats.identities} />
        <Stat label={t('structure.projects')} value={graph.stats.projects} />
        <Stat label={t('structure.signalTasks')} value={graph.stats.tasks} />
        <Stat label={t('structure.risk')} value={graph.stats.failedProjects + graph.stats.overdueProjects} color={STATUS_COLOR.failed} />
        <Stat label={t('structure.unowned')} value={graph.stats.unownedProjects} color={STATUS_COLOR.todo} />
        <Stat label={t('structure.dependencies')} value={graph.stats.dependencies || 0} color={STATUS_COLOR.failed} />
        {graph.stats.customNodes > 0 && (
          <Stat label={t('structure.customNodes')} value={graph.stats.customNodes} color="#818cf8" />
        )}
      </div>

      {!isTerritory && (
        <div className="kt-map-legend" aria-label={t('structure.legend')}>
          <span><i className="is-ownership" />{t('structure.legend.ownership')}</span>
          <span><i className="is-signal" />{t('structure.legend.signal')}</span>
          <span><i className="is-dependency" />{t('structure.legend.dependency')}</span>
        </div>
      )}
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
          {isTerritory ? (
            <TerritoryCanvas
              model={territoryModel}
              dependencyLinks={territoryDependencyLinks}
              selected={selected}
              selectedNodeKey={selectedNodeKey}
              onSelect={setSelected}
              onOpen={jumpTo}
              showEmpty={visibleProjects.length === 0}
              onClearFilters={clearFilters}
            />
          ) : (
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
              <MapCanvas
                layout={mapLayout}
                layoutStyle={layoutStyle}
                viewMode={viewMode}
                transform={transform}
                selectedNodeKey={selectedNodeKey}
                isNodeMuted={shouldMute}
                isLinkMuted={isLinkMuted}
                onSelect={setSelected}
                onOpen={jumpTo}
                showEmpty={visibleProjects.length === 0}
                onClearFilters={clearFilters}
              />
            </div>
          )}

          <MapInspector
            selected={selected}
            taskById={taskById}
            projectById={projectById}
            onSelect={setSelected}
            onClear={() => setSelected(null)}
            onJump={jumpTo}
          />
        </div>
      )}
    </div>
  )
}
