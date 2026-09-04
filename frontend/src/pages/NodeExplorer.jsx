import { useMemo, useState } from 'react'
import { qk } from '../api/queryKeys'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Boxes, List, Network, Plus, Trash2, Link2, X } from 'lucide-react'
import {
  getNodeTypes, getEdgeTypes, getNodes, getNode, createNode, deleteNode,
  getNodeEdges, attachNodeEdge, detachNodeEdge, getGraphMap,
} from '../api/client'
import { DARK } from '../constants/theme'
import { nodeHref } from '../utils/nodeHref'
import useAncestry from '../hooks/useAncestry'
import AncestryTrail from '../components/shared/AncestryTrail'
import EgoNetwork from '../components/shared/EgoNetwork'
import { useNodeTypeMap } from '../hooks/useNodeTypeMap'

function TypeChip({ typeMeta, typeKey }) {
  const color = typeMeta?.color || '#818cf8'
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
      textTransform: 'uppercase', letterSpacing: 0.4,
      color, background: `${color}22`, border: `1px solid ${color}44`,
    }}>
      {typeMeta?.label || typeKey}
    </span>
  )
}

export default function NodeExplorer() {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: nodeTypes = [] } = useQuery({ queryKey: qk.nodeTypes(), queryFn: getNodeTypes })
  const { data: edgeTypes = [] } = useQuery({ queryKey: qk.edgeTypes(), queryFn: getEdgeTypes })

  const [selectedType, setSelectedType] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [newTitle, setNewTitle] = useState('')
  const [relView, setRelView] = useState('list')
  const [attach, setAttach] = useState({ targetType: '', targetId: '', relType: 'contains' })

  // Default the type picker to the first available type once loaded.
  const effectiveType = selectedType || nodeTypes[0]?.key || ''
  const typeMeta = nodeTypes.find(nt => nt.key === effectiveType)
  const readOnly = !!typeMeta?.is_builtin // entity-backed builtins reject generic create/delete

  const typeByKey = useNodeTypeMap()
  const edgeTypeByKey = useMemo(() => new Map(edgeTypes.map(et => [et.key, et])), [edgeTypes])

  const { data: nodes = [], isLoading: nodesLoading } = useQuery({
    queryKey: qk.nodes(effectiveType),
    queryFn: () => getNodes(effectiveType),
    enabled: !!effectiveType,
  })
  // The selection is read from the server rather than found in the list above: the
  // graph re-centres onto neighbours, and a neighbour is usually of another type —
  // looking it up in the current type's page of results would lose it on every hop.
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
  const { data: targetNodes = [] } = useQuery({
    queryKey: qk.nodes(attach.targetType),
    queryFn: () => getNodes(attach.targetType),
    enabled: !!attach.targetType,
  })
  // One slice feeds the whole neighbourhood drawing, including the second hop —
  // walking it edge-endpoint by edge-endpoint would be a request per neighbour.
  const { data: slice, isLoading: sliceLoading } = useQuery({
    queryKey: qk.graphMap('explorer'),
    queryFn: () => getGraphMap(),
    enabled: relView === 'graph' && !!selectedId,
    staleTime: 30000,
  })

  const ancestry = useAncestry(nodes.map(n => n.id), `nodes:${effectiveType}`)

  const createMut = useMutation({
    mutationFn: createNode,
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.nodes(effectiveType) }); setNewTitle('') },
  })
  const deleteMut = useMutation({
    mutationFn: deleteNode,
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: qk.nodes(effectiveType) })
      qc.invalidateQueries({ queryKey: qk.graphMap('explorer') })
      if (id === selectedId) setSelectedId(null)
    },
  })
  const invalidateEdges = () => {
    qc.invalidateQueries({ queryKey: qk.nodeEdges(selectedId) })
    qc.invalidateQueries({ queryKey: qk.graphMap('explorer') })
    qc.invalidateQueries({ queryKey: qk.ancestry() })
  }
  const attachMut = useMutation({
    mutationFn: ({ id, body }) => attachNodeEdge(id, body),
    onSuccess: () => { invalidateEdges(); setAttach(a => ({ ...a, targetId: '' })) },
  })
  const detachMut = useMutation({
    mutationFn: ({ id, targetId, relType }) => detachNodeEdge(id, targetId, relType),
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
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, color: DARK.text }}>
                    {n.title || <em style={{ color: DARK.textDim }}>{t('nodeExplorer.untitled')}</em>}
                  </span>
                  {/* Where it lives, on the row (ADR-0094) — the whole list used to read
                      as a flat bag of titles with the hierarchy nowhere on screen. The
                      chips are links, so a click on one must not also select the row. */}
                  <span onClick={e => e.stopPropagation()}>
                    <AncestryTrail nodeId={n.id} entry={ancestry[n.id]} maxTrails={1} />
                  </span>
                </span>
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
                <AncestryTrail nodeId={selectedNode.id} className="kt-ancestry" />
                <Link to={nodeHref(selectedNode, typeByKey)} style={{ fontSize: 15, fontWeight: 700, color: DARK.text, textDecoration: 'none' }}>
                  {selectedNode.title || t('nodeExplorer.untitled')}
                </Link>
                <div><code style={{ fontSize: 11, color: DARK.textDim }}>{selectedNode.type} · {selectedNode.id}</code></div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: DARK.textDim, textTransform: 'uppercase', letterSpacing: 1 }}>
                  {t('nodeExplorer.edges')}
                </div>
                <span style={{ fontSize: 11, color: DARK.textDim }}>{edges.length}</span>
                <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
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
                <div style={{ fontSize: 12, color: DARK.textDim, padding: '12px 0' }}>{t('loading')}</div>
              ) : relView === 'graph' ? (
                <EgoNetwork
                  slice={slice}
                  centerId={selectedNode.id}
                  typeByKey={typeByKey}
                  edgeTypeByKey={edgeTypeByKey}
                  onRecenter={setSelectedId}
                />
              ) : edges.length === 0 ? (
                <div style={{ fontSize: 12, color: DARK.textDim, marginBottom: 12 }}>{t('nodeExplorer.noEdges')}</div>
              ) : (
                edges.map(e => {
                  const outgoing = e.source_id === selectedNode.id
                  // The endpoint's name travels with the edge (`EdgeOut.source`/`target`,
                  // embedded to spare clients an N+1). This row printed the raw id instead,
                  // so the one page whose subject *is* the relation named neither end of it.
                  const other = outgoing ? e.target : e.source
                  const otherId = outgoing ? e.target_id : e.source_id
                  return (
                    <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: `1px solid ${DARK.border}`, fontSize: 12 }}>
                      <Link2 size={12} color={DARK.textDim} />
                      <span style={{ color: '#818cf8', fontWeight: 600 }}>{edgeTypeByKey.get(e.rel_type)?.label || e.rel_type}</span>
                      <span style={{ color: DARK.textDim }}>{outgoing ? '→' : '←'}</span>
                      {other ? (
                        <>
                          <TypeChip typeMeta={typeByKey.get(other.type)} typeKey={other.type} />
                          <button
                            onClick={() => setSelectedId(other.id)}
                            title={other.id}
                            style={{
                              flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none',
                              cursor: 'pointer', padding: 0, fontSize: 12, color: DARK.text,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}
                          >
                            {other.title || t('nodeExplorer.untitled')}
                          </button>
                        </>
                      ) : (
                        <code style={{ flex: 1, color: DARK.textMid, fontSize: 11 }}>{otherId}</code>
                      )}
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
                {attachMut.isError && (
                  <div style={{ fontSize: 12, color: DARK.danger, marginTop: 6 }}>
                    {attachMut.error?.response?.data?.detail || t('nodePage.attachFailed')}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
