import { useState } from 'react'
import { qk } from '../api/queryKeys'
import { useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, History, Pencil, Trash2, X } from 'lucide-react'
import {
  getNode, getNodeEvents, getNodeTypes,
  updateNode, deleteNode,
} from '../api/client'
import { DARK, STATUS_COLOR } from '../constants/theme'
import NodeRelationsPanel from '../components/NodeRelationsPanel'
import TypeChip from '../components/shared/TypeChip'
import NodeShareFacet from '../components/NodeShareFacet'
import NodeFieldsPanel from '../components/NodeFieldsPanel'
import GoverningDecisions from '../components/GoverningDecisions'
import EmptyState from '../components/shared/EmptyState'
import AncestryTrail from '../components/shared/AncestryTrail'
import { hasNodeRole } from '../constants/nodeRoles'

// Universal node page (ADR-0037): one URL per node, edges grouped by rel_type
// and direction, neighbors navigable, provenance at the bottom.

function fmtDateTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

export default function NodePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: node, isLoading, isError } = useQuery({ queryKey: qk.node(id), queryFn: () => getNode(id) })
  const { data: events = [] } = useQuery({ queryKey: qk.nodeEvents(id), queryFn: () => getNodeEvents(id), enabled: !!node })
  const { data: nodeTypes = [] } = useQuery({ queryKey: qk.nodeTypes(), queryFn: getNodeTypes, staleTime: 300000 })

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [showEvents, setShowEvents] = useState(false)

  const typeMeta = nodeTypes.find(nt => nt.key === node?.type)

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

  if (isLoading) return <div className="kt-page"><div style={{ fontSize: 12, color: DARK.textDim }}>{t('loading')}</div></div>
  if (isError || !node) {
    return (
      <div className="kt-page">
        <EmptyState message={t('nodePage.notFound')} />
      </div>
    )
  }

  return (
    <div className="kt-page">
      {/* Header */}
      <div className="kt-card kt-card-section">
        {/* Where it lives, before what it is (ADR-0094). The relations panel below lists
            every edge; this says which of them is the node's place in the hierarchy.
            It replaced a `navigate(-1)` button labelled "back" (ADR-0156): browser back
            is not one level up — arrive here from a search and it returns you to the
            search — and it was the only up-shaped control the app had. */}
        <AncestryTrail nodeId={id} className="kt-ancestry" self={{ id, title: node.title, type: node.type }} />
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
              className="kt-icon-btn kt-icon-btn-danger"
              style={{ marginLeft: 'auto' }}
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

      {/* Relations. One panel, mounted on every page that shows a node (ADR-0155) —
          this page used to be the only one that had it, and `nodeHref` never sends a
          project or a container here, so the pages people actually stand on had no way
          to say what their node was attached to. */}
      <NodeRelationsPanel nodeId={id} nodeType={node.type} onChanged={invalidate} />

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
