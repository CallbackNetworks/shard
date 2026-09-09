import { useEffect, useMemo, useRef, useState } from 'react'
import { qk } from '../api/queryKeys'
import { Link, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Boxes, Plus, Search, Trash2, Unlink } from 'lucide-react'
import {
  getNodeTypes, getNodes, getNode, createNode, deleteNode,
  getNodeFacets, getEdgeCounts, attachNodeEdge,
} from '../api/client'
import { DARK, STATUS_COLOR } from '../constants/theme'
import { nodeHref } from '../utils/nodeHref'
import { formatTimestamp } from '../utils/datetime'
import useAncestry from '../hooks/useAncestry'
import AncestryTrail from '../components/shared/AncestryTrail'
import NodeRelationsPanel from '../components/NodeRelationsPanel'
import NodeCombobox from '../components/shared/NodeCombobox'
import TypeChip from '../components/shared/TypeChip'
import { useNodeTypeMap } from '../hooks/useNodeTypeMap'
import s from './NodeExplorer.module.css'

const PAGE = 100
const SORTS = ['recent', 'created', 'title', 'position']

// A status is a value the column happens to hold, not a member of a fixed vocabulary:
// task, project and decision have three different state machines and a custom type has
// whatever has been written into it. Only the four the design system names get a colour
// (ADR-0088); the rest get the neutral one rather than an invented hue.
function StatusDot({ status }) {
  if (!status) return null
  return <span className={s.statusDot} style={{ '--chip': STATUS_COLOR[status] || 'var(--kt-muted)' }} title={status} />
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
// ADR-0153 finished the job it started. Four things a page about data has to do and
// this one could not:
//
//   1. **Say what a row is.** Every row already arrived carrying `status`, `priority`,
//      `due_date` and `updated_at` on `NodeOut`, and the row drew a title. Which of a
//      hundred tasks is done, and which has not moved in a year, was not on screen.
//   2. **Be ordered by the question being asked.** The only order was `position,
//      created_at`, so the node you just made sorted *last* — past the first page,
//      findable only by already knowing its title.
//   3. **Accept what it just showed you.** The detail pane prints `type · id`; pasting
//      that id into the search box matched nothing, because `query` was a title filter.
//   4. **Act on more than one row.** `?loose=1` exists to find work nothing holds, and
//      the only way to file forty-one of them was forty-one selections.
//
// And one thing it refused to do for no reason: create and delete were hidden for every
// built-in type behind a comment claiming they were rejected. They are not — `POST
// /nodes` and `DELETE /nodes/{id}` are *the* write surface for every first-class entity
// (ADR-0040→0043) and the delete carries the full teardown (ADR-0131). So the loose
// filter could show you the orphans and nothing on the page could clear them.
export default function NodeExplorer() {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: nodeTypes = [] } = useQuery({ queryKey: qk.nodeTypes(), queryFn: getNodeTypes })

  // What is being looked at lives in the URL (ADR-0083), which is also what lets the
  // retired `/unfiled` page become a link into this one rather than a second page.
  // All six controls, not two: a view worth arriving at is a view worth linking to, and
  // the search text and the selection are most of what makes one view differ from another.
  const [params, setParams] = useSearchParams()
  const selectedType = params.get('type') || ''
  const loose = params.get('loose') === '1'
  const search = params.get('q') || ''
  const statusFilter = params.get('status') || ''
  const sort = SORTS.includes(params.get('sort')) ? params.get('sort') : 'recent'
  const selectedId = params.get('sel') || null
  const setParam = (patch) => setParams(prev => {
    const next = new URLSearchParams(prev)
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    return next
  }, { replace: true })
  const setSelectedType = (v) => setParam({ type: v, sel: '' })
  const setLoose = (v) => setParam({ loose: v ? '1' : '', sel: '' })
  const setSelectedId = (v) => setParam({ sel: v || '' })

  const [text, setText] = useState(search)
  const [offset, setOffset] = useState(0)
  const [newTitle, setNewTitle] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [bulkResult, setBulkResult] = useState(null)
  const searchRef = useRef(null)

  useEffect(() => {
    if (text.trim() === search) return
    const id = setTimeout(() => setParam({ q: text.trim() }), 200)
    return () => clearTimeout(id)
  }, [text]) // eslint-disable-line react-hooks/exhaustive-deps
  // Any change to what is being asked starts the paging over and drops the selection
  // set: keeping either would silently apply to a page of a different query.
  useEffect(() => {
    setOffset(0)
    setPicked(new Set())
    setBulkResult(null)
  }, [search, selectedType, loose, statusFilter, sort])

  // No type is the default, not `nodeTypes[0]`. The old default was whichever type the
  // registry happened to return first — here, Cycle: nineteen sprints, which is nobody's
  // reason for opening this page.
  const typeMeta = nodeTypes.find(nt => nt.key === selectedType)

  const typeByKey = useNodeTypeMap()

  const listArgs = { unfiled: loose, limit: PAGE, offset, status: statusFilter, sort }
  const { data: nodes = [], isLoading: nodesLoading, isFetching } = useQuery({
    queryKey: qk.nodes(selectedType || 'all', search, loose ? 'loose' : 'any', statusFilter, sort, offset),
    queryFn: () => getNodes(selectedType, search, listArgs),
    placeholderData: (prev) => prev,
  })

  // The honest denominator, under *every* narrowing. `usage_count` gave the per-type
  // total and nothing else, so the moment you typed in the search box the page went
  // back to reporting the length of the page it had drawn — the ADR-0150 lie in a
  // smaller place. This is a server-side COUNT of the filtered set, which is also what
  // lets paging know where it ends instead of inferring it from a full page.
  const { data: facets } = useQuery({
    queryKey: qk.nodeFacets(selectedType || 'all', search, loose ? 'loose' : 'any', statusFilter),
    queryFn: () => getNodeFacets({ type: selectedType, query: search, status: statusFilter, unfiled: loose }),
  })
  const total = facets?.total
  const statusFacets = facets?.status || []
  const statuses = useMemo(() => new Set(statusFilter ? statusFilter.split(',') : []), [statusFilter])
  const toggleStatus = (value) => {
    const next = new Set(statuses)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setParam({ status: [...next].join(','), sel: '' })
  }

  const pageIds = useMemo(() => nodes.map(n => n.id), [nodes])
  const ancestry = useAncestry(pageIds, `nodes:${selectedType}:${search}:${loose}:${statusFilter}:${sort}:${offset}`)
  // "Is this wired into anything" is the question the page exists to answer, and the
  // count is the per-row severity of it — not a substitute for the `loose` filter, which
  // is the broader question, not the narrower one. Measured here: zero-edge is a strict
  // *subset* of loose (11 of 32), because the other 21 are projects an identity `owns`
  // and nobody filed — one edge each, indistinguishable in this column, and the half
  // worth finding (ADR-0154).
  const { data: edgeCounts = {} } = useQuery({
    queryKey: qk.edgeCounts(pageIds.join(',')),
    queryFn: () => getEdgeCounts(pageIds),
    enabled: pageIds.length > 0,
  })

  const { data: selectedNode } = useQuery({
    queryKey: qk.node(selectedId),
    queryFn: () => getNode(selectedId),
    enabled: !!selectedId,
  })
  const invalidateList = () => {
    qc.invalidateQueries({ queryKey: qk.nodes() })
    qc.invalidateQueries({ queryKey: qk.nodeFacets() })
    qc.invalidateQueries({ queryKey: qk.edgeCounts() })
  }
  const invalidateEdges = () => {
    qc.invalidateQueries({ queryKey: qk.nodeEdges(selectedId) })
    qc.invalidateQueries({ queryKey: qk.graphMap() })
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
      qc.invalidateQueries({ queryKey: qk.graphMap() })
      if (id === selectedId) setSelectedId(null)
    },
  })
  // A batch is applied one row at a time and reports what happened to each, which is
  // the contract the importer already uses (ADR-0092): one refused row must not abandon
  // the other forty-three, and "12 filed, 2 refused" is the only honest summary of a
  // selection whose members have different types and therefore different legal parents.
  // Deliberately not a new endpoint — every edge and every delete here is already one
  // call on both doors, so a bulk route would be a convenience, not a capability, and
  // ADR-0085's rule is about capabilities.
  const runBatch = async (ids, act) => {
    let ok = 0
    const failed = []
    for (const id of ids) {
      try {
        await act(id)
        ok += 1
      } catch (err) {
        failed.push(err?.response?.data?.detail || String(err))
      }
    }
    setBulkResult({ ok, failed })
    setPicked(new Set())
    invalidateList()
    qc.invalidateQueries({ queryKey: qk.ancestry() })
    qc.invalidateQueries({ queryKey: qk.graphMap() })
  }
  const bulkMut = useMutation({ mutationFn: ({ ids, act }) => runBatch(ids, act) })

  const togglePick = (id) => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const allPicked = nodes.length > 0 && nodes.every(n => picked.has(n.id))
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(pageIds))

  // A containment source must hold `container` or `task`, or declare no roles at all —
  // the rule `add_edge` enforces, asked of the registry rather than restated here.
  const canContain = (n) => {
    const roles = typeByKey.get(n.type)?.roles || []
    return roles.length === 0 || roles.includes('container') || roles.includes('task')
  }

  const from = total === 0 ? 0 : offset + 1
  const to = offset + nodes.length
  const hasMore = total === undefined ? nodes.length === PAGE : to < total

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
            onClick={() => setSelectedType('')}
          >
            <span className={s.typeName}>{t('nodeExplorer.allTypes')}</span>
          </button>
          {nodeTypes.map(nt => (
            <button
              key={nt.key}
              className={`${s.typeRow} ${selectedType === nt.key ? s.typeRowActive : ''}`}
              onClick={() => setSelectedType(nt.key)}
            >
              <span className={s.typeDot} style={{ '--chip': nt.color || '#818cf8' }} />
              <span className={s.typeName}>{nt.label}</span>
              <span className={s.typeCount}>{nt.usage_count ?? 0}</span>
            </button>
          ))}

          {/* One list, one grammar: everything that narrows the set is a row with a
              count (ADR-0154). Loose used to be a section of its own — heading, tick
              box and a three-line note — carrying no number, so the only way to learn
              whether anything was loose was to tick it, on the one filter whose whole
              job is to surface what you did not know was there. Its note moved to the
              row's tooltip; the long version lives in the guide.

              The status rows are served, never mirrored (ADR-0056): a COUNT over the
              column under the current narrowing, so the list stays true for a custom
              type nobody has told the app about — and `none` is on it, because a NULL
              status is a real state and often the set most worth looking at (ADR-0141). */}
          <div className={s.filterHead} style={{ marginTop: 16 }}>{t('nodeExplorer.filterNarrow')}</div>
          <label className={s.facetRow} data-tour="explorer-loose" title={t('nodeExplorer.looseHint')}>
            <input type="checkbox" checked={loose} onChange={e => setLoose(e.target.checked)} />
            <span className={s.looseGlyph}>◇</span>
            <span className={s.typeName}>{t('nodeExplorer.looseOnly')}</span>
            <span className={s.typeCount}>{facets?.loose ?? ''}</span>
          </label>
          {statusFacets.length > 1 && statusFacets.map(f => {
            const value = f.value === null ? 'none' : f.value
            return (
              <label key={value} className={s.facetRow}>
                <input type="checkbox" checked={statuses.has(value)} onChange={() => toggleStatus(value)} />
                <StatusDot status={f.value} />
                <span className={s.typeName}>{f.value === null ? t('nodeExplorer.statusNone') : f.value}</span>
                <span className={s.typeCount}>{f.count}</span>
              </label>
            )
          })}
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
            {/* One sentence now, because there is one fact. The old page had two — the
                type's own total when nothing was narrowing, and "n shown" the moment
                anything was, which is a count of the page rather than of the answer. */}
            {total === undefined
              ? t('nodeExplorer.countShown', { n: nodes.length })
              : t('nodeExplorer.countRange', { from, to, total })}
            {isFetching && <span className={s.fetching}>{t('loading')}</span>}
            {/* Beside the count rather than at the foot of the filter column: sort
                describes the list you are reading, not what is being kept out of it. */}
            <select
              className={`kt-input ${s.sortSelect}`}
              aria-label={t('nodeExplorer.sort')}
              value={sort}
              onChange={e => setParam({ sort: e.target.value })}
            >
              {SORTS.map(key => <option key={key} value={key}>{t(`nodeExplorer.sort_${key}`)}</option>)}
            </select>
          </div>

          {selectedType && (
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
          {createMut.isError && (
            <p className={s.error}>{createMut.error?.response?.data?.detail || t('nodeExplorer.createFailed')}</p>
          )}
          {typeMeta?.is_builtin && (
            <p className={s.readOnlyHint}>{t('nodeExplorer.builtinHint', { type: typeMeta.label })}</p>
          )}

          {/* The batch bar. `?loose=1` is a triage filter and triage one row at a time
              is not triage — the forty-four orphans it finds were forty-four selections
              and forty-four pickers. */}
          {picked.size > 0 && (
            <div className={s.bulkBar}>
              <span className={s.bulkCount}>{t('nodeExplorer.selected', { n: picked.size })}</span>
              <span className={s.bulkLabel}>{t('nodeExplorer.fileInto')}</span>
              <NodeCombobox
                placeholder={t('nodeExplorer.fileIntoPlaceholder')}
                filter={canContain}
                excludeIds={[...picked]}
                onSelect={(container) => bulkMut.mutate({
                  ids: [...picked],
                  act: (id) => attachNodeEdge(container.id, { target_id: id, rel_type: 'contains' }),
                })}
              />
              <button
                className="kt-btn"
                disabled={bulkMut.isPending}
                onClick={() => {
                  if (window.confirm(t('nodeExplorer.bulkDeleteConfirm', { n: picked.size }))) {
                    bulkMut.mutate({ ids: [...picked], act: (id) => deleteNode(id) })
                  }
                }}
              >
                <Trash2 size={12} /> {t('nodeExplorer.deleteSelected')}
              </button>
              <button className="kt-btn" onClick={() => setPicked(new Set())}>{t('nodeExplorer.clearSelection')}</button>
            </div>
          )}
          {bulkResult && (
            <p className={bulkResult.failed.length ? s.error : s.readOnlyHint}>
              {t('nodeExplorer.bulkResult', { ok: bulkResult.ok, failed: bulkResult.failed.length })}
              {bulkResult.failed[0] ? ` — ${bulkResult.failed[0]}` : ''}
            </p>
          )}

          {nodesLoading ? (
            <div className={s.dim}>{t('loading')}</div>
          ) : nodes.length === 0 ? (
            <div className={s.dim}>{t('nodeExplorer.empty')}</div>
          ) : (
            <>
              <label className={s.selectAll}>
                <input type="checkbox" checked={allPicked} onChange={toggleAll} />
                <span>{t('nodeExplorer.selectAll', { n: nodes.length })}</span>
              </label>
              {nodes.map(n => (
                <div
                  key={n.id}
                  onClick={() => setSelectedId(n.id)}
                  className={`${s.row} ${n.id === selectedId ? s.rowActive : ''}`}
                >
                  <input
                    type="checkbox"
                    aria-label={n.title || n.id}
                    checked={picked.has(n.id)}
                    onClick={e => e.stopPropagation()}
                    onChange={() => togglePick(n.id)}
                  />
                  <TypeChip typeMeta={typeByKey.get(n.type)} typeKey={n.type} />
                  <span className={s.rowBody}>
                    <span className={s.rowTitle}>
                      <StatusDot status={n.status} />
                      {n.title || <em className={s.dim}>{t('nodeExplorer.untitled')}</em>}
                    </span>
                    {/* Where it lives, on the row (ADR-0094) — the list used to read as a
                        flat bag of titles with the hierarchy nowhere on screen. The chips
                        are links, so a click on one must not also select the row. The
                        trail cap is the component's own default: a node with two parents
                        is an anomaly, and this is the page you would come to to find one. */}
                    <span onClick={e => e.stopPropagation()}>
                      <AncestryTrail nodeId={n.id} entry={ancestry[n.id]} showOwners={false} />
                    </span>
                  </span>
                  {/* The facts that were on the wire all along and nowhere on screen. */}
                  <span className={s.rowMeta} title={n.updated_at}>
                    <span className={edgeCounts[n.id] === 0 ? s.zeroEdges : undefined}>
                      <Unlink size={10} style={{ verticalAlign: -1 }} /> {edgeCounts[n.id] ?? '·'}
                    </span>
                    <span>{formatTimestamp(n.updated_at)}</span>
                  </span>
                  {/* Opening is a *second* act here, not the click on the row: the row
                      click fills the pane on the right, and collapsing the two would
                      cost the pane its only way of being filled. So it gets a control
                      of its own rather than a double-click nobody would guess at
                      (ADR-0156). It stops propagation for the same reason the trail
                      chips do — following a link must not also re-select the row. */}
                  <Link
                    to={nodeHref(n, typeByKey)}
                    onClick={e => e.stopPropagation()}
                    className={s.iconBtn}
                    aria-label={t('nodeExplorer.open')}
                    title={t('nodeExplorer.open')}
                  >
                    <ArrowUpRight size={14} />
                  </Link>
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      if (window.confirm(t('nodeExplorer.deleteConfirm', { title: n.title || n.id }))) deleteMut.mutate(n.id)
                    }}
                    aria-label="delete" disabled={deleteMut.isPending}
                    className={s.iconBtn}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </>
          )}

          {(offset > 0 || hasMore) && (
            <div className={s.pager}>
              <button className="kt-btn" disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - PAGE))}>
                {t('nodeExplorer.prev')}
              </button>
              <button className="kt-btn" disabled={!hasMore} onClick={() => setOffset(o => o + PAGE)}>
                {t('nodeExplorer.next')}
              </button>
            </div>
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
                {/* Printed so it can be copied, and now accepted back: `query` matches an
                    id prefix from eight characters (ADR-0153). */}
                <div><code className={s.detailMeta}>{selectedNode.type} · {selectedNode.id}</code></div>
              </div>

              {/* One relations panel, the same one the project page, the container
                  view, the identity card and `/n/{id}` now draw (ADR-0155). This pane
                  was the third hand-written copy of the list. */}
              <NodeRelationsPanel
                nodeId={selectedNode.id}
                nodeType={selectedNode.type}
                heading={t('nodeExplorer.edges')}
                onOpenNeighbour={ref => setSelectedId(ref.id)}
                onChanged={invalidateEdges}
                compact
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
