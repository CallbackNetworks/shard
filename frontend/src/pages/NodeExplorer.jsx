import { useEffect, useMemo, useRef, useState } from 'react'
import { qk } from '../api/queryKeys'
import { Link, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Boxes, List, Network, Plus, Search, Trash2, Link2, X } from 'lucide-react'
import {
  getNodeTypes, getEdgeTypes, getNodes, getNode, createNode, deleteNode,
  getNodeEdges, detachNodeEdge, getGraphMap,
} from '../api/client'
import { DARK } from '../constants/theme'
import { nodeHref } from '../utils/nodeHref'
import useAncestry from '../hooks/useAncestry'
import AncestryTrail from '../components/shared/AncestryTrail'
import EgoNetwork from '../components/shared/EgoNetwork'
import RelationPicker from '../components/shared/RelationPicker'
import { useNodeTypeMap } from '../hooks/useNodeTypeMap'
import s from './NodeExplorer.module.css'

const PAGE = 100

function TypeChip({ typeMeta, typeKey }) {
  const color = typeMeta?.color || '#818cf8'
  return (
    <span className={s.typeChip} style={{ '--chip': color }}>
      {typeMeta?.label || typeKey}
    </span>
  )
}

// The one page for looking at the graph as data (ADR-0150). It replaces three doors
// that each showed a slice and none of which let you find anything:
//
//   * this page listed one type at a time with **no search box**, took the endpoint's
//     default page of 100, drew it, and printed *that* as the count — so a database
//     holding 144 tasks said "100 nodes" and 44 of them were unreachable from here;
//   * `/unfiled` asked "has no incoming containment edge", which is also true of every
//     root, so an organization holding twenty-one projects sat in an inbox forever
//     under a hint telling you to file it under something;
//   * `/containers` spent a permanent rail row on a two-card menu of container *types*,
//     a strict subset of what the type registry page already draws.
//
// So: one search across every type, the true totals beside each type, real paging, and
// the selected node's relations editable in place through the shared picker.
export default function NodeExplorer() {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: nodeTypes = [] } = useQuery({ queryKey: qk.nodeTypes(), queryFn: getNodeTypes })
  const { data: edgeTypes = [] } = useQuery({ queryKey: qk.edgeTypes(), queryFn: getEdgeTypes })

  // What is being looked at lives in the URL (ADR-0083), which is also what lets the
  // retired `/unfiled` page become a link into this one rather than a second page.
  const [params, setParams] = useSearchParams()
  const selectedType = params.get('type') || ''
  const loose = params.get('loose') === '1'
  const setParam = (key, value) => setParams(prev => {
    const next = new URLSearchParams(prev)
    if (value) next.set(key, value)
    else next.delete(key)
    return next
  }, { replace: true })
  const setSelectedType = (v) => setParam('type', v)
  const setLoose = (v) => setParam('loose', v ? '1' : '')
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [selectedId, setSelectedId] = useState(null)
  const [newTitle, setNewTitle] = useState('')
  const [relView, setRelView] = useState('list')
  const searchRef = useRef(null)

  useEffect(() => {
    const id = setTimeout(() => setSearch(text.trim()), 200)
    return () => clearTimeout(id)
  }, [text])
  // Any change to what is being asked starts the paging over; keeping the old limit
  // would silently hand back a page of a different query.
  useEffect(() => { setLimit(PAGE) }, [search, selectedType, loose])

  // No type is the default, not `nodeTypes[0]`. The old default was whichever type the
  // registry happened to return first — here, Cycle: nineteen sprints, which is nobody's
  // reason for opening this page.
  const typeMeta = nodeTypes.find(nt => nt.key === selectedType)
  const readOnly = !!typeMeta?.is_builtin // entity-backed builtins reject generic create/delete

  const typeByKey = useNodeTypeMap()
  const edgeTypeByKey = useMemo(() => new Map(edgeTypes.map(et => [et.key, et])), [edgeTypes])

  const { data: nodes = [], isLoading: nodesLoading, isFetching } = useQuery({
    queryKey: qk.nodes(selectedType || 'all', search, loose ? 'loose' : 'any', limit),
    queryFn: () => getNodes(selectedType, search, { unfiled: loose, limit }),
  })

  // The honest denominator. `usage_count` is a COUNT on the server, so it does not move
  // when the page size does — which is the entire difference between this line and the
  // one it replaces.
  const totalForType = typeMeta?.usage_count
  const narrowed = !!search || loose
  const maybeMore = nodes.length >= limit

  const { data: selectedNode } = useQuery({
    queryKey: qk.node(selectedId),
    queryFn: () => getNode(selectedId),
    enabled: !!selectedId,
  })
  const { data: edges = [] } = useQuery({
    queryKey: qk.nodeEdges(selectedId),
    queryFn: () => getNodeEdges(selectedId),
    enabled: !!selectedId,
  })
  // One slice feeds the whole neighbourhood drawing, including the second hop —
  // walking it edge-endpoint by edge-endpoint would be a request per neighbour.
  const { data: slice, isLoading: sliceLoading } = useQuery({
    queryKey: qk.graphMap('explorer'),
    queryFn: () => getGraphMap(),
    enabled: relView === 'graph' && !!selectedId,
    staleTime: 30000,
  })

  const ancestry = useAncestry(nodes.map(n => n.id), `nodes:${selectedType}:${search}:${loose}`)

  const invalidateList = () => qc.invalidateQueries({ queryKey: qk.nodes() })
  const invalidateEdges = () => {
    qc.invalidateQueries({ queryKey: qk.nodeEdges(selectedId) })
    qc.invalidateQueries({ queryKey: qk.graphMap('explorer') })
    qc.invalidateQueries({ queryKey: qk.ancestry() })
    invalidateList()
  }
  const createMut = useMutation({
    mutationFn: createNode,
    onSuccess: () => { invalidateList(); setNewTitle('') },
  })
  const deleteMut = useMutation({
    mutationFn: deleteNode,
    onSuccess: (_d, id) => {
      invalidateList()
      qc.invalidateQueries({ queryKey: qk.graphMap('explorer') })
      if (id === selectedId) setSelectedId(null)
    },
  })
  const detachMut = useMutation({
    mutationFn: ({ sourceId, targetId, relType }) => detachNodeEdge(sourceId, targetId, relType),
    onSuccess: invalidateEdges,
  })

  return (
    <div className="kt-page">
      <div className="kt-page-header">
        <div className="kt-page-heading">
          <h1 className="kt-page-title">{t('nodeExplorer.title')}</h1>
          <p className="kt-page-subtitle">{t('nodeExplorer.subtitle')}</p>
        </div>
        <Boxes size={22} color="#818cf8" />
      </div>

      <div className={s.layout}>
        {/* Left: what to look at. Types carry their real totals, so the number beside
            a type never disagrees with the number of rows you can reach. */}
        <div className={`kt-card ${s.filters}`} data-tour="explorer-types">
          <div className={s.filterHead}>{t('nodeExplorer.filterType')}</div>
          <button
            className={`${s.typeRow} ${!selectedType ? s.typeRowActive : ''}`}
            onClick={() => { setSelectedType(''); setSelectedId(null) }}
          >
            <span className={s.typeName}>{t('nodeExplorer.allTypes')}</span>
          </button>
          {nodeTypes.map(nt => (
            <button
              key={nt.key}
              className={`${s.typeRow} ${selectedType === nt.key ? s.typeRowActive : ''}`}
              onClick={() => { setSelectedType(nt.key); setSelectedId(null) }}
            >
              <span className={s.typeDot} style={{ '--chip': nt.color || '#818cf8' }} />
              <span className={s.typeName}>{nt.label}</span>
              <span className={s.typeCount}>{nt.usage_count ?? 0}</span>
            </button>
          ))}

          <div className={s.filterHead} style={{ marginTop: 16 }}>{t('nodeExplorer.filterShape')}</div>
          <label className={s.looseToggle} data-tour="explorer-loose">
            <input type="checkbox" checked={loose} onChange={e => setLoose(e.target.checked)} />
            <span>{t('nodeExplorer.looseOnly')}</span>
          </label>
          <p className={s.looseHint}>{t('nodeExplorer.looseHint')}</p>
        </div>

        {/* Middle: find it. */}
        <div className={`kt-card ${s.results}`}>
          <div className={s.searchRow} data-tour="explorer-search">
            <Search size={13} color={DARK.textDim} className={s.searchIcon} />
            <input
              ref={searchRef}
              className="kt-input"
              style={{ paddingLeft: 28 }}
              placeholder={t('nodeExplorer.searchPlaceholder')}
              aria-label={t('nodeExplorer.searchPlaceholder')}
              value={text}
              onChange={e => setText(e.target.value)}
            />
          </div>

          <div className={s.countRow}>
            {/* Two different sentences, because they are two different facts. Without a
                narrowing filter the type's own total is known and shown; with one, only
                what came back is known, and claiming a total would be the old lie in a
                new place. */}
            {narrowed || !selectedType
              ? t('nodeExplorer.countShown', { n: nodes.length })
              : t('nodeExplorer.countOf', { n: nodes.length, total: totalForType ?? nodes.length })}
            {isFetching && <span className={s.fetching}>{t('loading')}</span>}
          </div>

          {!readOnly && selectedType && (
            <div className={s.createRow}>
              <input
                className="kt-input"
                placeholder={t('nodeExplorer.titlePlaceholder')}
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newTitle) createMut.mutate({ type: selectedType, title: newTitle }) }}
              />
              <button
                className="kt-btn kt-btn-primary"
                disabled={!newTitle || createMut.isPending}
                onClick={() => createMut.mutate({ type: selectedType, title: newTitle })}
              >
                <Plus size={12} /> {t('nodeExplorer.add')}
              </button>
            </div>
          )}
          {readOnly && selectedType && (
            <p className={s.readOnlyHint}>{t('nodeExplorer.readOnlyHint')}</p>
          )}

          {nodesLoading ? (
            <div className={s.dim}>{t('loading')}</div>
          ) : nodes.length === 0 ? (
            <div className={s.dim}>{t('nodeExplorer.empty')}</div>
          ) : (
            nodes.map(n => (
              <div
                key={n.id}
                onClick={() => setSelectedId(n.id)}
                className={`${s.row} ${n.id === selectedId ? s.rowActive : ''}`}
              >
                <TypeChip typeMeta={typeByKey.get(n.type)} typeKey={n.type} />
                <span className={s.rowBody}>
                  <span className={s.rowTitle}>
                    {n.title || <em className={s.dim}>{t('nodeExplorer.untitled')}</em>}
                  </span>
                  {/* Where it lives, on the row (ADR-0094) — the list used to read as a
                      flat bag of titles with the hierarchy nowhere on screen. The chips
                      are links, so a click on one must not also select the row. */}
                  <span onClick={e => e.stopPropagation()}>
                    <AncestryTrail nodeId={n.id} entry={ancestry[n.id]} maxTrails={1} showOwners={false} />
                  </span>
                </span>
                {!typeByKey.get(n.type)?.is_builtin && (
                  <button
                    onClick={e => { e.stopPropagation(); if (window.confirm(t('nodeExplorer.deleteConfirm'))) deleteMut.mutate(n.id) }}
                    aria-label="delete" disabled={deleteMut.isPending}
                    className={s.iconBtn}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))
          )}

          {maybeMore && (
            <button className={`kt-btn ${s.more}`} onClick={() => setLimit(l => l + PAGE)}>
              {t('nodeExplorer.loadMore')}
            </button>
          )}
        </div>

        {/* Right: what it is connected to, and the one control that connects it. */}
        <div className={`kt-card ${s.detail}`} data-tour="explorer-detail">
          {!selectedNode ? (
            <div className={s.dim}>{t('nodeExplorer.selectHint')}</div>
          ) : (
            <>
              <div style={{ marginBottom: 14 }}>
                <AncestryTrail nodeId={selectedNode.id} className="kt-ancestry" />
                <Link to={nodeHref(selectedNode, typeByKey)} className={s.detailTitle}>
                  {selectedNode.title || t('nodeExplorer.untitled')}
                </Link>
                <div><code className={s.detailMeta}>{selectedNode.type} · {selectedNode.id}</code></div>
              </div>

              <div className={s.detailHead}>
                <span className={s.filterHead}>{t('nodeExplorer.edges')}</span>
                <span className={s.dim}>{edges.length}</span>
                <div className={s.viewToggle}>
                  <button
                    className="kt-btn" aria-pressed={relView === 'list'} title={t('nodeExplorer.viewList')}
                    onClick={() => setRelView('list')}
                    style={{ opacity: relView === 'list' ? 1 : 0.55 }}
                  >
                    <List size={12} /> {t('nodeExplorer.viewList')}
                  </button>
                  <button
                    className="kt-btn" aria-pressed={relView === 'graph'} title={t('nodeExplorer.viewGraph')}
                    onClick={() => setRelView('graph')}
                    style={{ opacity: relView === 'graph' ? 1 : 0.55 }}
                  >
                    <Network size={12} /> {t('nodeExplorer.viewGraph')}
                  </button>
                </div>
              </div>

              {relView === 'graph' && sliceLoading ? (
                <div className={s.dim} style={{ padding: '12px 0' }}>{t('loading')}</div>
              ) : relView === 'graph' ? (
                <EgoNetwork
                  slice={slice}
                  centerId={selectedNode.id}
                  typeByKey={typeByKey}
                  edgeTypeByKey={edgeTypeByKey}
                  onRecenter={setSelectedId}
                />
              ) : edges.length === 0 ? (
                <div className={s.dim} style={{ marginBottom: 12 }}>{t('nodeExplorer.noEdges')}</div>
              ) : (
                edges.map(e => {
                  const outgoing = e.source_id === selectedNode.id
                  // The endpoint's name travels with the edge (`EdgeOut.source`/`target`,
                  // embedded to spare clients an N+1). This row printed the raw id instead,
                  // so the one page whose subject *is* the relation named neither end of it.
                  const other = outgoing ? e.target : e.source
                  const otherId = outgoing ? e.target_id : e.source_id
                  return (
                    <div key={e.id} className={s.edgeRow}>
                      <Link2 size={12} color={DARK.textDim} />
                      <span className={s.relName}>{edgeTypeByKey.get(e.rel_type)?.label || e.rel_type}</span>
                      <span className={s.dim}>{outgoing ? '→' : '←'}</span>
                      {other ? (
                        <>
                          <TypeChip typeMeta={typeByKey.get(other.type)} typeKey={other.type} />
                          <button onClick={() => setSelectedId(other.id)} title={other.id} className={s.neighbour}>
                            {other.title || t('nodeExplorer.untitled')}
                          </button>
                        </>
                      ) : (
                        <code className={s.rawId}>{otherId}</code>
                      )}
                      {/* Detaching used to be offered on outgoing edges only, so a
                          relation created from the other end could be seen here and
                          never removed. `remove_edge` takes the pair either way round. */}
                      <button
                        onClick={() => detachMut.mutate(outgoing
                          ? { sourceId: selectedNode.id, targetId: e.target_id, relType: e.rel_type }
                          : { sourceId: e.source_id, targetId: selectedNode.id, relType: e.rel_type })}
                        aria-label="detach"
                        className={s.iconBtn}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )
                })
              )}

              <div style={{ marginTop: 16 }}>
                <div className={s.filterHead} style={{ marginBottom: 6 }}>{t('nodeExplorer.attachEdge')}</div>
                <RelationPicker
                  nodeId={selectedNode.id}
                  nodeType={selectedNode.type}
                  onLinked={invalidateEdges}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
