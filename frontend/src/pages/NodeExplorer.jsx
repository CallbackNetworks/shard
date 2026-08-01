import { useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Boxes, Plus, Trash2, Link2, X } from 'lucide-react'
import {
  getNodeTypes, getEdgeTypes, getNodes, createNode, deleteNode,
  getNodeEdges, attachNodeEdge, detachNodeEdge,
} from '../api/client'
import { DARK } from '../constants/theme'

export default function NodeExplorer() {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: nodeTypes = [] } = useQuery({ queryKey: ['node-types'], queryFn: getNodeTypes })
  const { data: edgeTypes = [] } = useQuery({ queryKey: ['edge-types'], queryFn: getEdgeTypes })

  const [selectedType, setSelectedType] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [newTitle, setNewTitle] = useState('')
  const [attach, setAttach] = useState({ targetType: '', targetId: '', relType: 'contains' })

  // Default the type picker to the first available type once loaded.
  const effectiveType = selectedType || nodeTypes[0]?.key || ''
  const typeMeta = nodeTypes.find(nt => nt.key === effectiveType)
  const readOnly = !!typeMeta?.is_builtin // entity-backed builtins reject generic create/delete

  const { data: nodes = [], isLoading: nodesLoading } = useQuery({
    queryKey: ['nodes', effectiveType],
    queryFn: () => getNodes(effectiveType),
    enabled: !!effectiveType,
  })
  const { data: edges = [] } = useQuery({
    queryKey: ['node-edges', selectedId],
    queryFn: () => getNodeEdges(selectedId),
    enabled: !!selectedId,
  })
  const { data: targetNodes = [] } = useQuery({
    queryKey: ['nodes', attach.targetType],
    queryFn: () => getNodes(attach.targetType),
    enabled: !!attach.targetType,
  })

  const createMut = useMutation({
    mutationFn: createNode,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nodes', effectiveType] }); setNewTitle('') },
  })
  const deleteMut = useMutation({
    mutationFn: deleteNode,
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['nodes', effectiveType] })
      if (id === selectedId) setSelectedId(null)
    },
  })
  const attachMut = useMutation({
    mutationFn: ({ id, body }) => attachNodeEdge(id, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['node-edges', selectedId] }); setAttach(a => ({ ...a, targetId: '' })) },
  })
  const detachMut = useMutation({
    mutationFn: ({ id, targetId, relType }) => detachNodeEdge(id, targetId, relType),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['node-edges', selectedId] }),
  })

  const selectedNode = nodes.find(n => n.id === selectedId)

  return (
    <div className="kt-page">
      <div className="kt-page-header">
        <div className="kt-page-heading">
          <h1 className="kt-page-title">{t('nodeExplorer.title')}</h1>
          <p className="kt-page-subtitle">{t('nodeExplorer.subtitle')}</p>
        </div>
        <Boxes size={22} color="#818cf8" />
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left: type picker + node list */}
        <div className="kt-card" style={{ padding: 20, flex: '1 1 340px', minWidth: 300 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
            <select
              className="kt-input" style={{ width: 'auto', minWidth: 160 }}
              value={effectiveType}
              onChange={e => { setSelectedType(e.target.value); setSelectedId(null) }}
            >
              {nodeTypes.map(nt => (
                <option key={nt.key} value={nt.key}>{nt.label}{nt.is_builtin ? '' : ' *'}</option>
              ))}
            </select>
            <span style={{ fontSize: 12, color: DARK.textDim }}>{t('nodeExplorer.count', { n: nodes.length })}</span>
          </div>

          {!readOnly && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <input
                className="kt-input" style={{ flex: 1 }}
                placeholder={t('nodeExplorer.titlePlaceholder')}
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newTitle && effectiveType) createMut.mutate({ type: effectiveType, title: newTitle }) }}
              />
              <button
                className="kt-btn kt-btn-primary"
                disabled={!newTitle || !effectiveType || createMut.isPending}
                onClick={() => createMut.mutate({ type: effectiveType, title: newTitle })}
              >
                <Plus size={12} /> {t('nodeExplorer.add')}
              </button>
            </div>
          )}
          {readOnly && (
            <p style={{ margin: '0 0 12px', fontSize: 12, color: DARK.textDim }}>{t('nodeExplorer.readOnlyHint')}</p>
          )}

          {nodesLoading ? (
            <div style={{ fontSize: 12, color: DARK.textDim }}>{t('loading')}</div>
          ) : nodes.length === 0 ? (
            <div style={{ fontSize: 12, color: DARK.textDim }}>{t('nodeExplorer.empty')}</div>
          ) : (
            nodes.map(n => (
              <div
                key={n.id}
                onClick={() => setSelectedId(n.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px', cursor: 'pointer',
                  borderBottom: `1px solid ${DARK.border}`,
                  background: n.id === selectedId ? 'rgba(129,140,248,0.1)' : 'transparent',
                }}
              >
                <span style={{ flex: 1, fontSize: 13, color: DARK.text }}>{n.title || <em style={{ color: DARK.textDim }}>{t('nodeExplorer.untitled')}</em>}</span>
                {!readOnly && (
                  <button
                    onClick={e => { e.stopPropagation(); if (window.confirm(t('nodeExplorer.deleteConfirm'))) deleteMut.mutate(n.id) }}
                    aria-label="delete" disabled={deleteMut.isPending}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: DARK.textMid, padding: 4 }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {/* Right: selected node edges */}
        <div className="kt-card" style={{ padding: 20, flex: '1 1 340px', minWidth: 300 }}>
          {!selectedNode ? (
            <div style={{ fontSize: 12, color: DARK.textDim }}>{t('nodeExplorer.selectHint')}</div>
          ) : (
            <>
              <div style={{ marginBottom: 14 }}>
                <Link to={`/n/${selectedNode.id}`} style={{ fontSize: 15, fontWeight: 700, color: DARK.text, textDecoration: 'none' }}>
                  {selectedNode.title || t('nodeExplorer.untitled')}
                </Link>
                <div><code style={{ fontSize: 11, color: DARK.textDim }}>{selectedNode.type} · {selectedNode.id}</code></div>
              </div>

              <div style={{ fontSize: 11, fontWeight: 700, color: DARK.textDim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                {t('nodeExplorer.edges')}
              </div>
              {edges.length === 0 ? (
                <div style={{ fontSize: 12, color: DARK.textDim, marginBottom: 12 }}>{t('nodeExplorer.noEdges')}</div>
              ) : (
                edges.map(e => {
                  const outgoing = e.source_id === selectedNode.id
                  const other = outgoing ? e.target_id : e.source_id
                  return (
                    <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: `1px solid ${DARK.border}`, fontSize: 12 }}>
                      <Link2 size={12} color={DARK.textDim} />
                      <span style={{ color: '#818cf8', fontWeight: 600 }}>{e.rel_type}</span>
                      <span style={{ color: DARK.textDim }}>{outgoing ? '→' : '←'}</span>
                      <code style={{ flex: 1, color: DARK.textMid, fontSize: 11 }}>{other}</code>
                      {outgoing && (
                        <button
                          onClick={() => detachMut.mutate({ id: selectedNode.id, targetId: e.target_id, relType: e.rel_type })}
                          aria-label="detach"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: DARK.textMid, padding: 2 }}
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  )
                })
              )}

              {/* Attach edge */}
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: DARK.textDim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                  {t('nodeExplorer.attachEdge')}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select
                    className="kt-input" style={{ width: 'auto' }}
                    value={attach.relType}
                    onChange={e => setAttach({ ...attach, relType: e.target.value })}
                  >
                    {edgeTypes.map(et => <option key={et.key} value={et.key}>{et.label}</option>)}
                  </select>
                  <select
                    className="kt-input" style={{ width: 'auto' }}
                    value={attach.targetType}
                    onChange={e => setAttach({ ...attach, targetType: e.target.value, targetId: '' })}
                  >
                    <option value="">{t('nodeExplorer.targetType')}</option>
                    {nodeTypes.map(nt => <option key={nt.key} value={nt.key}>{nt.label}</option>)}
                  </select>
                  <select
                    className="kt-input" style={{ width: 'auto', minWidth: 140 }}
                    value={attach.targetId}
                    onChange={e => setAttach({ ...attach, targetId: e.target.value })}
                    disabled={!attach.targetType}
                  >
                    <option value="">{t('nodeExplorer.targetNode')}</option>
                    {targetNodes.filter(n => n.id !== selectedNode.id).map(n => (
                      <option key={n.id} value={n.id}>{n.title || n.id}</option>
                    ))}
                  </select>
                  <button
                    className="kt-btn kt-btn-primary"
                    disabled={!attach.targetId || attachMut.isPending}
                    onClick={() => attachMut.mutate({ id: selectedNode.id, body: { target_id: attach.targetId, rel_type: attach.relType } })}
                  >
                    <Plus size={12} /> {t('nodeExplorer.attach')}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
