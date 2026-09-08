import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Link2, List, Network, X } from 'lucide-react'
import { getEdgeTypes, getGraphMap, getNodeEdges, detachNodeEdge } from '../api/client'
import { qk } from '../api/queryKeys'
import { STATUS_COLOR } from '../constants/theme'
import { nodeHref } from '../utils/nodeHref'
import { useNodeTypeMap } from '../hooks/useNodeTypeMap'
import TypeChip from './shared/TypeChip'
import RelationPicker from './shared/RelationPicker'
import EgoNetwork from './shared/EgoNetwork'
import s from './NodeRelationsPanel.module.css'

// A node's relations, listed and created where the node is read (ADR-0155).
//
// ADR-0150 collapsed the three *pickers* into one control and left the three *lists*
// where they were — `NodePage`, the explorer's detail pane and `MembershipPanel` — so
// the rule about which relations exist was shared and the place you could act on it
// was not. The consequence was not drift, it was reach: of the pages a node actually
// opens on, only `/n/{id}` drew this panel, and `nodeHref` sends a project to
// `/projects/{id}` and any other container to `/c/{id}`. A project therefore had no
// link to its own node page anywhere in the app — the one type that holds nearly
// everything could only be attached to an identity from the Data page.
//
// So this is one component mounted on every page that shows a node: the project page,
// the container view, the identity card, the universal node page and the explorer's
// detail pane. Collapsed by default where the page's subject is the work rather than
// the graph, because a relations list is a thing you go looking for, not something a
// project page should open with.
export default function NodeRelationsPanel({
  nodeId,
  nodeType,
  hideRels,
  heading,
  compact = false,
  collapsible = false,
  defaultOpen = true,
  showGraph = true,
  onOpenNeighbour,
  onChanged,
  className,
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(collapsible ? defaultOpen : true)
  const [view, setView] = useState('list')

  const typeByKey = useNodeTypeMap()
  const { data: edgeTypes = [] } = useQuery({ queryKey: qk.edgeTypes(), queryFn: getEdgeTypes, staleTime: 300000 })
  // Fetched even while collapsed, deliberately: the header carries the count, and a
  // collapsed panel reading "0" over five real relations is worse than no number —
  // the count is the whole reason to open it (ADR-0154's rule, one screen along).
  const { data: allEdges = [], isPending: edgesPending } = useQuery({
    queryKey: qk.nodeEdges(nodeId),
    queryFn: () => getNodeEdges(nodeId),
    enabled: !!nodeId,
  })
  // The neighbourhood drawing needs two hops, so it reads one slice rather than a
  // request per neighbour — and only once the graph view is actually asked for.
  const { data: slice, isLoading: sliceLoading } = useQuery({
    queryKey: qk.graphMap('relations'),
    queryFn: () => getGraphMap(),
    enabled: view === 'graph' && open && !!nodeId,
    staleTime: 30000,
  })

  const edgeTypeByKey = useMemo(() => new Map(edgeTypes.map(et => [et.key, et])), [edgeTypes])
  const edges = useMemo(
    () => (hideRels ? allEdges.filter(e => !hideRels.has(e.rel_type)) : allEdges),
    [allEdges, hideRels],
  )

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.nodeEdges(nodeId) })
    qc.invalidateQueries({ queryKey: qk.graphMap() })
    qc.invalidateQueries({ queryKey: qk.ancestry() })
    onChanged?.()
  }

  const detachMut = useMutation({
    mutationFn: ({ sourceId, targetId, relType }) => detachNodeEdge(sourceId, targetId, relType),
    onSuccess: invalidate,
  })

  // Grouped by relation, containment first: where a node lives is read before what
  // else it touches (ADR-0078's two axes, in the order a reader wants them).
  const groups = useMemo(() => {
    const byRel = new Map()
    for (const e of edges) {
      if (!byRel.has(e.rel_type)) byRel.set(e.rel_type, [])
      byRel.get(e.rel_type).push(e)
    }
    return [...byRel.keys()]
      .sort((a, b) => {
        const ca = edgeTypeByKey.get(a)?.is_containment ? 0 : 1
        const cb = edgeTypeByKey.get(b)?.is_containment ? 0 : 1
        return ca - cb || a.localeCompare(b)
      })
      .map(rel => ({
        rel,
        rows: byRel.get(rel).sort((x, y) => Number(y.source_id === nodeId) - Number(x.source_id === nodeId)),
      }))
  }, [edges, edgeTypeByKey, nodeId])

  const openNeighbour = (ref, fallbackId) => {
    if (onOpenNeighbour) return onOpenNeighbour(ref || { id: fallbackId })
    navigate(ref ? nodeHref(ref, typeByKey) : `/n/${fallbackId}`)
  }

  // Per relation, so the picker can drop a node this one is already linked to *by
  // that relation* without hiding it from every other one.
  const linkedByRel = useMemo(() => {
    const m = new Map()
    for (const e of allEdges) {
      if (!m.has(e.rel_type)) m.set(e.rel_type, new Set())
      m.get(e.rel_type).add(e.source_id === nodeId ? e.target_id : e.source_id)
    }
    return m
  }, [allEdges, nodeId])

  const title = heading || t('nodePage.relations')

  return (
    <div className={[compact ? s.plain : 'kt-card', s.panel, className].filter(Boolean).join(' ')}>
      <div className={s.head}>
        {collapsible ? (
          <button className={s.toggle} onClick={() => setOpen(o => !o)} aria-expanded={open}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Link2 size={14} className={s.icon} />
            <span className={s.title}>{title}</span>
            <span className={s.count}>{edges.length}</span>
          </button>
        ) : (
          <>
            <Link2 size={14} className={s.icon} />
            <span className={s.title}>{title}</span>
            <span className={s.count}>{edges.length}</span>
          </>
        )}
        {open && showGraph && (
          <div className={s.viewToggle}>
            <button
              className="kt-btn" aria-pressed={view === 'list'} title={t('nodeExplorer.viewList')}
              onClick={() => setView('list')} style={{ opacity: view === 'list' ? 1 : 0.55 }}
            >
              <List size={12} /> {t('nodeExplorer.viewList')}
            </button>
            <button
              className="kt-btn" aria-pressed={view === 'graph'} title={t('nodeExplorer.viewGraph')}
              onClick={() => setView('graph')} style={{ opacity: view === 'graph' ? 1 : 0.55 }}
            >
              <Network size={12} /> {t('nodeExplorer.viewGraph')}
            </button>
          </div>
        )}
      </div>

      {open && (view === 'graph' ? (
        sliceLoading
          ? <div className={s.dim}>{t('loading')}</div>
          : (
            <EgoNetwork
              slice={slice}
              centerId={nodeId}
              typeByKey={typeByKey}
              edgeTypeByKey={edgeTypeByKey}
              onRecenter={id => openNeighbour(null, id)}
            />
          )
      ) : (
        <>
          {/* "No relations yet" is a claim, so it waits for the answer — the pane
              used to assert it while the request was still in flight. */}
          {groups.length === 0 && (
            <div className={s.dim}>{edgesPending ? t('loading') : t('nodePage.noRelations')}</div>
          )}
          {groups.map(g => (
            <div key={g.rel} className={s.group}>
              <div className={s.relHead}>{edgeTypeByKey.get(g.rel)?.label || g.rel}</div>
              {g.rows.map(e => {
                const outgoing = e.source_id === nodeId
                const other = outgoing ? e.target : e.source
                const otherId = outgoing ? e.target_id : e.source_id
                // The far end's name is in the label, not just "Detach": a node with
                // six relations otherwise has six buttons a screen reader cannot tell
                // apart, which is the state `MembershipPanel` had already avoided.
                const detachLabel = `${t('nodePage.detach')} ${other?.title || otherId}`
                return (
                  <div key={e.id} className={s.row}>
                    <span className={s.dir}>{outgoing ? '→' : '←'}</span>
                    {other ? (
                      <>
                        <TypeChip typeMeta={typeByKey.get(other.type)} typeKey={other.type} />
                        <button className={s.neighbour} onClick={() => openNeighbour(other)} title={other.id}>
                          {other.title || t('nodePage.untitled')}
                        </button>
                        {other.status && (
                          <span className={s.status} style={{ color: STATUS_COLOR[other.status] || 'var(--kt-muted)' }}>
                            {other.status}
                          </span>
                        )}
                      </>
                    ) : (
                      <code className={s.rawId}>{otherId}</code>
                    )}
                    {/* Either end detaches: `remove_edge` takes the pair whichever way
                        round it is stored, and a relation created from the other side
                        used to be visible here and impossible to remove. */}
                    <button
                      className={s.iconBtn}
                      aria-label={detachLabel}
                      title={t('nodePage.detach')}
                      disabled={detachMut.isPending}
                      onClick={() => detachMut.mutate(outgoing
                        ? { sourceId: nodeId, targetId: e.target_id, relType: e.rel_type }
                        : { sourceId: e.source_id, targetId: nodeId, relType: e.rel_type })}
                    >
                      <X size={12} />
                    </button>
                  </div>
                )
              })}
            </div>
          ))}

          {/* The one picker (ADR-0150): it asks the server which relations this type can
              be an end of, and in which direction. */}
          <div className={s.picker}>
            <RelationPicker
              nodeId={nodeId}
              nodeType={nodeType}
              linkedByRel={linkedByRel}
              onLinked={invalidate}
              compact={compact}
            />
          </div>
        </>
      ))}
    </div>
  )
}
