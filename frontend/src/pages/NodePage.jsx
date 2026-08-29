import { useMemo, useState } from 'react'
import { qk } from '../api/queryKeys'
import { useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, History, Link2, Pencil, Plus, Trash2, X } from 'lucide-react'
import {
  getNode, getNodeEdges, getNodeEvents, getNodeTypes, getEdgeTypes,
  updateNode, deleteNode, attachNodeEdge, detachNodeEdge,
} from '../api/client'
import { DARK, STATUS_COLOR } from '../constants/theme'
import NodeCombobox from '../components/shared/NodeCombobox'
import NodeShareFacet from '../components/NodeShareFacet'
import NodeFieldsPanel from '../components/NodeFieldsPanel'
import GoverningDecisions from '../components/GoverningDecisions'
import EmptyState from '../components/shared/EmptyState'
import AncestryTrail from '../components/shared/AncestryTrail'
import { hasNodeRole } from '../constants/nodeRoles'
import { nodeHref } from '../utils/nodeHref'

// Universal node page (ADR-0037): one URL per node, edges grouped by rel_type
// and direction, neighbors navigable, provenance at the bottom.

function fmtDateTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

function TypeChip({ typeMeta, typeKey }) {
  const color = typeMeta?.color || '#818cf8'
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 3, flexShrink: 0,
      textTransform: 'uppercase', letterSpacing: 0.5,
      color, background: `${color}22`, border: `1px solid ${color}44`,
    }}>
      {typeMeta?.label || typeKey}
    </span>
  )
}

function NeighborRow({ edge, refNode, outgoing, onOpen, onDetach, detaching }) {
  const { t } = useTranslation()
  const statusColor = refNode?.status ? (STATUS_COLOR[refNode.status] || DARK.textDim) : null
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '7px 4px',
      borderBottom: `1px solid ${DARK.border}`, fontSize: 13,
    }}>
      <span style={{ color: DARK.textDim, fontSize: 11, width: 14, textAlign: 'center' }}>{outgoing ? '→' : '←'}</span>
      {refNode ? (
        <>
          <NeighborBadge type={refNode.type} />
          <button
            onClick={() => onOpen(refNode)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left',
              flex: 1, fontSize: 13, color: DARK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {refNode.title || <em style={{ color: DARK.textDim }}>{t('nodePage.untitled')}</em>}
          </button>
          {statusColor && (
            <span style={{ fontSize: 11, color: statusColor, flexShrink: 0 }}>{refNode.status}</span>
          )}
        </>
      ) : (
        <code style={{ flex: 1, color: DARK.textMid, fontSize: 11 }}>{outgoing ? edge.target_id : edge.source_id}</code>
      )}
      <button
        onClick={onDetach}
        disabled={detaching}
        aria-label={t('nodePage.detach')}
        title={t('nodePage.detach')}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: DARK.textMid, padding: 2 }}
      >
        <X size={13} />
      </button>
    </div>
  )
}

function NeighborBadge({ type }) {
  const { data: nodeTypes = [] } = useQuery({ queryKey: qk.nodeTypes(), queryFn: getNodeTypes, staleTime: 300000 })
  const nt = nodeTypes.find(x => x.key === type)
  return <TypeChip typeMeta={nt} typeKey={type} />
}

export default function NodePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: node, isLoading, isError } = useQuery({ queryKey: qk.node(id), queryFn: () => getNode(id) })
  const { data: edges = [] } = useQuery({ queryKey: qk.nodeEdges(id), queryFn: () => getNodeEdges(id), enabled: !!node })
  const { data: events = [] } = useQuery({ queryKey: qk.nodeEvents(id), queryFn: () => getNodeEvents(id), enabled: !!node })
  const { data: nodeTypes = [] } = useQuery({ queryKey: qk.nodeTypes(), queryFn: getNodeTypes, staleTime: 300000 })
  const { data: edgeTypes = [] } = useQuery({ queryKey: qk.edgeTypes(), queryFn: getEdgeTypes, staleTime: 300000 })

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [attach, setAttach] = useState({ relType: 'contains', open: false })
  const [showEvents, setShowEvents] = useState(false)

  const typeMeta = nodeTypes.find(nt => nt.key === node?.type)
  const typeByKey = useMemo(() => new Map(nodeTypes.map(nt => [nt.key, nt])), [nodeTypes])
  const edgeTypeByKey = useMemo(() => new Map(edgeTypes.map(et => [et.key, et])), [edgeTypes])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.node(id) })
    qc.invalidateQueries({ queryKey: qk.nodeEdges(id) })
    qc.invalidateQueries({ queryKey: qk.nodeEvents(id) })
  }

  const renameMut = useMutation({
    mutationFn: (title) => updateNode(id, { title }),
    onSuccess: () => { invalidate(); setEditingTitle(false) },
  })
  const deleteMut = useMutation({
    mutationFn: () => deleteNode(id),
    onSuccess: () => navigate(-1),
  })
  const attachMut = useMutation({
    mutationFn: (targetId) => attachNodeEdge(id, { target_id: targetId, rel_type: attach.relType }),
    onSuccess: invalidate,
  })
  const detachMut = useMutation({
    mutationFn: ({ sourceId, targetId, relType }) => detachNodeEdge(sourceId, targetId, relType),
    onSuccess: invalidate,
  })

  // Group edges by rel_type, containment types first, direction split inside.
  const groups = useMemo(() => {
    const byRel = new Map()
    for (const e of edges) {
      if (!byRel.has(e.rel_type)) byRel.set(e.rel_type, { out: [], inc: [] })
      const g = byRel.get(e.rel_type)
      if (e.source_id === id) g.out.push(e)
      else g.inc.push(e)
    }
    const keys = [...byRel.keys()].sort((a, b) => {
      const ca = edgeTypeByKey.get(a)?.is_containment ? 0 : 1
      const cb = edgeTypeByKey.get(b)?.is_containment ? 0 : 1
      return ca - cb || a.localeCompare(b)
    })
    return keys.map(k => ({ relType: k, ...byRel.get(k) }))
  }, [edges, id, edgeTypeByKey])

  if (isLoading) return <div className="kt-page"><div style={{ fontSize: 12, color: DARK.textDim }}>{t('loading')}</div></div>
  if (isError || !node) {
    return (
      <div className="kt-page">
        <EmptyState message={t('nodePage.notFound')} />
      </div>
    )
  }

  const openNeighbor = (ref) => navigate(nodeHref(ref, typeByKey))
  const edgeIds = new Set([id, ...edges.flatMap(e => [e.source_id, e.target_id])])

  return (
    <div className="kt-page">
      <button
        onClick={() => navigate(-1)}
        className="kt-btn"
        style={{ marginBottom: 14 }}
      >
        <ArrowLeft size={12} /> {t('nodePage.back')}
      </button>

      {/* Header */}
      <div className="kt-card" style={{ padding: 20, marginBottom: 16 }}>
        {/* Where it lives, before what it is (ADR-0094). The relations panel below lists
            every edge; this says which of them is the node's place in the hierarchy. */}
        <AncestryTrail nodeId={id} className="kt-ancestry" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <TypeChip typeMeta={typeMeta} typeKey={node.type} />
          {editingTitle ? (
            <span style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1, minWidth: 220 }}>
              <input
                className="kt-input" style={{ flex: 1 }}
                value={titleDraft} autoFocus
                onChange={e => setTitleDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && titleDraft.trim()) renameMut.mutate(titleDraft.trim())
                  if (e.key === 'Escape') setEditingTitle(false)
                }}
              />
              <button className="kt-btn kt-btn-primary" disabled={!titleDraft.trim() || renameMut.isPending} onClick={() => renameMut.mutate(titleDraft.trim())} aria-label={t('save')}>
                <Check size={12} />
              </button>
              <button className="kt-btn" onClick={() => setEditingTitle(false)} aria-label={t('cancel')}>
                <X size={12} />
              </button>
            </span>
          ) : (
            <>
              <h1 className="kt-page-title" style={{ margin: 0, fontSize: 20 }}>
                {node.title || <em style={{ color: DARK.textDim }}>{t('nodePage.untitled')}</em>}
              </h1>
              <button
                onClick={() => { setTitleDraft(node.title || ''); setEditingTitle(true) }}
                aria-label={t('edit')} title={t('edit')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: DARK.textMid, padding: 4 }}
              >
                <Pencil size={13} />
              </button>
            </>
          )}
          {hasNodeRole(typeMeta, 'container') && node.type !== 'project' && (
            <button
              className="kt-btn"
              onClick={() => navigate(`/c/${id}`)}
              style={{ marginLeft: 'auto' }}
            >
              {t('nodePage.openContainer')}
            </button>
          )}
          {typeMeta && !typeMeta.is_builtin && (
            <button
              onClick={() => { if (window.confirm(t('nodePage.deleteConfirm'))) deleteMut.mutate() }}
              aria-label={t('delete')} title={t('delete')}
              disabled={deleteMut.isPending}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: DARK.danger, padding: 4, marginLeft: 'auto' }}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 12, color: DARK.textMid, flexWrap: 'wrap' }}>
          {node.status && <span style={{ color: STATUS_COLOR[node.status] || DARK.textMid }}>{node.status}</span>}
          {node.priority && <span>{t('nodePage.priority')}: {node.priority}</span>}
          {node.due_date && <span>{t('nodePage.due')}: {fmtDateTime(node.due_date)}</span>}
          <code style={{ fontSize: 11, color: DARK.textDim }}>{node.id}</code>
        </div>
      </div>

      {/* Why this node exists (ADR-0118's `governs`, read from the work's side). Above
          the fields on purpose: the decision that produced a node explains it in a way
          none of its own columns can. Renders nothing when nothing governs it. */}
      <GoverningDecisions nodeId={id} className="kt-node-governed" editable />

      {/* The type's own fields (ADR-0074), drawn from its declaration. */}
      <NodeFieldsPanel node={node} typeMeta={typeMeta} />

      {/* Share (ADR-0039, ADR-0070): the universal node page is the only home a
          shareable node has when its type is not a container — without this its
          share page existed with nowhere to rotate or protect the token. */}
      {hasNodeRole(typeMeta, 'shareable') && (
        <NodeShareFacet node={node} subscribable={hasNodeRole(typeMeta, 'subscribable')} />
      )}

      {/* Relations */}
      <div className="kt-card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Link2 size={15} color="#818cf8" />
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: DARK.text }}>{t('nodePage.relations')}</h3>
          <span style={{ fontSize: 11, color: DARK.textDim }}>{edges.length}</span>
        </div>

        {groups.length === 0 && (
          <div style={{ fontSize: 12, color: DARK.textDim, marginBottom: 10 }}>{t('nodePage.noRelations')}</div>
        )}
        {groups.map(g => {
          const et = edgeTypeByKey.get(g.relType)
          return (
            <div key={g.relType} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: DARK.textDim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>
                {et?.label || g.relType}
              </div>
              {[...g.out.map(e => ({ e, outgoing: true })), ...g.inc.map(e => ({ e, outgoing: false }))].map(({ e, outgoing }) => (
                <NeighborRow
                  key={e.id}
                  edge={e}
                  refNode={outgoing ? e.target : e.source}
                  outgoing={outgoing}
                  onOpen={openNeighbor}
                  detaching={detachMut.isPending}
                  onDetach={() => detachMut.mutate(outgoing
                    ? { sourceId: id, targetId: e.target_id, relType: e.rel_type }
                    : { sourceId: e.source_id, targetId: id, relType: e.rel_type })}
                />
              ))}
            </div>
          )
        })}

        {/* Attach */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
          <select
            className="kt-input" style={{ width: 'auto' }}
            aria-label={t('nodePage.relType')}
            value={attach.relType}
            onChange={e => setAttach(a => ({ ...a, relType: e.target.value }))}
          >
            {edgeTypes.map(et => <option key={et.key} value={et.key}>{et.label}</option>)}
          </select>
          <NodeCombobox
            placeholder={t('nodePage.attachPlaceholder')}
            excludeIds={[...edgeIds]}
            onSelect={(n) => attachMut.mutate(n.id)}
          />
          <Plus size={13} color={DARK.textDim} />
        </div>
        {attachMut.isError && (
          <div style={{ fontSize: 12, color: DARK.danger, marginTop: 6 }}>
            {attachMut.error?.response?.data?.detail || t('nodePage.attachFailed')}
          </div>
        )}
      </div>

      {/* Provenance */}
      <div className="kt-card" style={{ padding: 20 }}>
        <button
          onClick={() => setShowEvents(s => !s)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          <History size={15} color="#818cf8" />
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: DARK.text }}>{t('nodePage.history')}</h3>
          <span style={{ fontSize: 11, color: DARK.textDim }}>{events.length}</span>
        </button>
        {showEvents && (
          events.length === 0 ? (
            <div style={{ fontSize: 12, color: DARK.textDim, marginTop: 10 }}>{t('nodePage.noHistory')}</div>
          ) : (
            <div style={{ marginTop: 10 }}>
              {events.map(ev => (
                <div key={ev.id} style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: `1px solid ${DARK.border}`, fontSize: 12 }}>
                  <span style={{ color: '#818cf8', fontWeight: 600, minWidth: 90 }}>{ev.event}</span>
                  {ev.rel_type && <span style={{ color: DARK.textMid }}>{ev.rel_type}</span>}
                  {ev.actor && <span style={{ color: DARK.textMid }}>{ev.actor}</span>}
                  <span style={{ marginLeft: 'auto', color: DARK.textDim }}>{fmtDateTime(ev.created_at)}</span>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
