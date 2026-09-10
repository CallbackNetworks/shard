import { useMemo, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import { deriveGraphStructure } from '../../utils/graphStructure'
import { buildMindMapLayout, buildNetworkLayout, buildTreeLayout, taskWeight } from '../../utils/structureMapLayout'
import { buildShareSlice, SHARE_EDGE_TYPES, SHARE_NODE_TYPES } from '../../utils/shareGraph'
import { STATUS_COLOR } from '../../constants/theme'
import useMapViewport from '../../hooks/useMapViewport'
import MapCanvas from '../structure/MapCanvas'
import useScrollReveal from './useScrollReveal'
import s from './ShareStructureMap.module.css'

/**
 * The shared work, drawn (ADR-0157). Same derivation, same layout algorithms and the
 * same canvas the owner's `/structure` page uses — fed a slice projected from the
 * public payload instead of `GET /api/graph/map`, so the picture a visitor sees cannot
 * drift from the one the owner sees. What this page does *not* take from that page is
 * its orchestration: no search, no filters, no focus, no navigation. A visitor has
 * nowhere to jump to, so a node here selects and nothing more.
 *
 * Dependencies are always drawn (`viewMode = 'dependencies'`): "what is waiting on
 * what" is most of why a stranger opens this link, and it is the relation the page
 * previously hid three levels down inside a task's expander.
 *
 * No i18n here matches the rest of `components/share/`; `MapCanvas` carries its own,
 * which is the price of drawing it with the same component rather than a second one.
 */

// The owner's map defaults to `territory`, which is a menu of container cards and says
// nothing about a share holding one project. `sankey` is the default here because it is
// the layout that grows *downwards*: `lines` puts every task in one row, so a project
// with a dozen of them is 2350px wide and the fit-to-frame scale drops it to 37% —
// legible on a full page, unreadable in a band inside a document. Names match the
// owner's map (ADR-0058: the same thing keeps the same word).
const STYLES = [
  { key: 'sankey', label: 'SANKEY' },
  { key: 'lines', label: 'TREE' },
  { key: 'network', label: 'NETWORK' },
]

// The layouts place one row of task cards under a container; past this the row stops
// being readable and the heaviest work is what a visitor came to see. Ranked by the
// map's own weight (risk, then how many edges the task sits on), never truncated
// silently — the count below the canvas says what was left out.
const TASK_CAP = 30

const nodeKey = (node) => (node ? `${node.type}:${node.id}` : null)

export default function ShareStructureMap({ payload, color }) {
  const [ref, visible] = useScrollReveal(0.1)
  const [layoutStyle, setLayoutStyle] = useState('sankey')
  const [selected, setSelected] = useState(null)

  const graph = useMemo(
    () => deriveGraphStructure(buildShareSlice(payload), SHARE_NODE_TYPES, SHARE_EDGE_TYPES),
    [payload]
  )

  const rankedTasks = useMemo(
    () => [...graph.allTaskNodes].sort((a, b) => taskWeight(b) - taskWeight(a) || a.name.localeCompare(b.name)),
    [graph.allTaskNodes]
  )

  const layout = useMemo(() => {
    const visibleTaskNodes = rankedTasks.slice(0, TASK_CAP)
    const visibleIds = new Set(visibleTaskNodes.map(task => task.id))
    const params = {
      visibleProjects: graph.projectNodes,
      visibleIdentityNodes: graph.identityNodes,
      visibleTaskNodes,
      laneNodes: graph.decisionNodes.map(node => ({
        ...node,
        lane: 'decision',
        color: node.status === 'proposed' ? STATUS_COLOR.in_progress : STATUS_COLOR.done,
      })),
      // A dependency arc to a task the cap dropped would end in nothing.
      dependencyLinks: graph.dependencyLinks.filter(
        link => visibleIds.has(link.from.replace('task:', '')) && visibleIds.has(link.to.replace('task:', ''))
      ),
      viewMode: 'dependencies',
    }
    if (layoutStyle === 'network') {
      // The network layout places custom relations itself; the other two do not, so
      // `governs` and `supersedes` are appended to the finished layout below.
      return buildNetworkLayout({ ...params, customNodes: [], customLinks: graph.customLinks })
    }
    const base = layoutStyle === 'lines' ? buildTreeLayout(params) : buildMindMapLayout(params)
    // A decision's own relations, drawn on the two columnar layouts. `type: 'decision'`
    // is what makes them accent links in `MapCanvas`: dashed, and hidden until a node
    // is selected — a hundred decision arcs at rest is the resting picture ADR-0128's
    // dimming exists to get away from. Placed after the layout because they connect
    // nodes two different bands put down, which no single layout pass owns.
    const links = [
      ...base.links,
      ...graph.customLinks
        .filter(link => base.nodeById.has(link.from) && base.nodeById.has(link.to))
        .map(link => ({ ...link, type: 'decision', color: STATUS_COLOR.done })),
    ]
    return { ...base, links }
  }, [graph, rankedTasks, layoutStyle])

  const {
    graphRef, transform, zoomBy, resetView, handleGraphKeyDown,
    startPan, movePan, endPan, zoomMap, handleGraphClickCapture,
  } = useMapViewport({ width: layout.width, height: layout.height })

  const selectedKey = nodeKey(selected)
  // Selecting dims what the selection does not touch, one hop out — the same question
  // the decision graph answers by dimming (ADR-0128), asked of the whole map.
  const connected = useMemo(() => {
    if (!selectedKey) return null
    const keys = new Set([selectedKey])
    for (const link of layout.links) {
      if (link.from === selectedKey) keys.add(link.to)
      if (link.to === selectedKey) keys.add(link.from)
    }
    return keys
  }, [selectedKey, layout.links])

  const isNodeMuted = (data) => Boolean(connected) && !connected.has(nodeKey(data))
  const isLinkMuted = (link) => Boolean(connected) && !(connected.has(link.from) && connected.has(link.to))

  const hidden = rankedTasks.length - Math.min(rankedTasks.length, TASK_CAP)
  // Two nodes and no edge is not a shape; below that the section says nothing the
  // project card above it did not already say.
  if (layout.nodes.length < 2) return null

  return (
    <div ref={ref} className={visible ? `${s.wrap} ${s.visible}` : s.wrap} style={{ '--share-accent': color }}>
      <div className={s.head}>
        <span className={s.title}>Structure</span>
        <span className={s.count}>{layout.nodes.length}</span>
        <span className={s.spacer} />
        <div className="kt-map-segment" aria-label="Layout style">
          {STYLES.map(style => (
            <button
              key={style.key}
              type="button"
              onClick={() => setLayoutStyle(style.key)}
              className={layoutStyle === style.key ? 'is-active' : ''}
            >
              {style.label}
            </button>
          ))}
        </div>
        <div className="kt-map-controls" aria-label="View controls">
          <button type="button" onClick={() => zoomBy(0.14)} title="Zoom in" aria-label="Zoom in"><Plus size={14} /></button>
          <button type="button" onClick={() => zoomBy(-0.14)} title="Zoom out" aria-label="Zoom out"><Minus size={14} /></button>
          <button type="button" onClick={resetView} title="Fit" aria-label="Fit"><Maximize2 size={14} /></button>
        </div>
      </div>
      <div className={s.blurb}>How the work hangs together — what holds what, what is waiting on what, and which decision governs which task. Select a node to follow its links.</div>

      <div
        ref={graphRef}
        className="kt-map-graph is-embedded"
        role="region"
        aria-label="Structure graph"
        tabIndex={0}
        onKeyDown={handleGraphKeyDown}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onLostPointerCapture={endPan}
        onWheel={zoomMap}
        onClickCapture={handleGraphClickCapture}
        onClick={(event) => { if (!event.target.closest('.kt-map-node, button, a')) setSelected(null) }}
      >
        <MapCanvas
          layout={layout}
          layoutStyle={layoutStyle}
          viewMode="dependencies"
          transform={transform}
          selectedNodeKey={selectedKey}
          isNodeMuted={isNodeMuted}
          isLinkMuted={isLinkMuted}
          onSelect={setSelected}
          showEmpty={false}
          taskColumnLabel="TASKS"
        />
      </div>

      {/* The owner's legend minus `signal`: in dependencies mode a container's link to
          its work is drawn grey whatever the task's risk, so that entry would name a
          colour nothing on this canvas has. The decision arc appears on selection. */}
      <div className="kt-map-legend" aria-label="Legend">
        <span><i />holds</span>
        <span><i className="is-dependency" />blocked by</span>
        <span><i className="is-decision" />decision (on select)</span>
        {hidden > 0 && <span>{hidden} lighter {hidden === 1 ? 'task' : 'tasks'} not drawn</span>}
        {selected && <span className={s.selected}>{selected.name}</span>}
      </div>
    </div>
  )
}
