import { useState } from 'react'
import { qk } from '../api/queryKeys'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Inbox, FolderInput, Boxes } from 'lucide-react'
import {
  getUnfiledTasks, fileTaskIntoProject, getProjects,
  getNodeTypes, getEdgeTypes, getGraphMap,
} from '../api/client'
import { DARK } from '../constants/theme'
import { hasNodeRole } from '../constants/nodeRoles'

// What this node *is* attached to, even though nothing contains it. The page's whole
// premise is an empty containment trail, so a breadcrumb here would always be blank —
// the useful question is whether the node is connected to the graph at all, and by what.
// Counts rather than a list of neighbours: a row is one line, and the node page is one
// click away for the detail.
function RelationChips({ counts, edgeTypeByKey }) {
  const { t } = useTranslation()
  const entries = Object.entries(counts || {})
  if (entries.length === 0) {
    return <span style={{ fontSize: 11, color: DARK.textDim }}>{t('unfiled.noRelations')}</span>
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {entries.sort((a, b) => b[1] - a[1]).map(([rel, n]) => (
        <span
          key={rel}
          style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 9999,
            border: '1px solid rgba(var(--kt-ink-rgb), 0.12)',
            color: 'rgba(var(--kt-ink-rgb), 0.55)',
          }}
        >
          {edgeTypeByKey.get(rel)?.label || rel} {n}
        </span>
      ))}
    </span>
  )
}

function TaskRow({ task, projects, onFile, filing, relations, edgeTypeByKey }) {
  const { t } = useTranslation()
  const [projectId, setProjectId] = useState('')
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 0', borderBottom: `1px solid ${DARK.border}`,
    }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, color: DARK.text }}>{task.title}</span>
        <RelationChips counts={relations} edgeTypeByKey={edgeTypeByKey} />
      </span>
      <span style={{
        fontSize: 10, fontWeight: 700, padding: '1px 6px', textTransform: 'uppercase',
        background: 'rgba(var(--kt-ink-rgb), 0.06)', color: DARK.textDim,
      }}>
        {task.status}
      </span>
      <select
        className="kt-input" style={{ width: 'auto', minWidth: 150 }}
        value={projectId}
        onChange={e => setProjectId(e.target.value)}
      >
        <option value="">{t('unfiled.chooseProject')}</option>
        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button
        className="kt-btn kt-btn-primary"
        disabled={!projectId || filing}
        onClick={() => onFile(task.id, projectId)}
      >
        <FolderInput size={12} /> {t('unfiled.file')}
      </button>
    </div>
  )
}

export default function Unfiled() {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: tasks = [], isLoading } = useQuery({ queryKey: qk.unfiledTasks(), queryFn: getUnfiledTasks })
  const { data: projects = [] } = useQuery({ queryKey: qk.projects(), queryFn: getProjects })

  const fileMut = useMutation({
    mutationFn: ({ taskId, projectId }) => fileTaskIntoProject(taskId, projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.unfiledTasks() })
      qc.invalidateQueries({ queryKey: qk.projects() })
    },
  })

  const activeProjects = projects.filter(p => p.status !== 'archived')

  // Unfiled custom nodes (ADR-0037): custom-type nodes with no incoming
  // containment edge, derived client-side from the /graph/map slice.
  const { data: nodeTypes = [] } = useQuery({ queryKey: qk.nodeTypes(), queryFn: getNodeTypes, staleTime: 300000 })
  const { data: edgeTypes = [] } = useQuery({ queryKey: qk.edgeTypes(), queryFn: getEdgeTypes, staleTime: 300000 })
  const customTypes = nodeTypes.filter(nt => !nt.is_builtin)
  // Fetched unconditionally now: the slice is what tells each row which relations it
  // does have, and that is the point of the page whether or not custom types exist.
  const { data: graphMap } = useQuery({
    queryKey: qk.graphMap('unfiled'),
    queryFn: () => getGraphMap(),
  })
  const edgeTypeByKey = new Map(edgeTypes.map(et => [et.key, et]))
  const relationsByNode = {}
  for (const e of graphMap?.edges || []) {
    for (const id of [e.source_id, e.target_id]) {
      const counts = relationsByNode[id] || (relationsByNode[id] = {})
      counts[e.rel_type] = (counts[e.rel_type] || 0) + 1
    }
  }
  const containmentRels = new Set(edgeTypes.filter(et => et.is_containment).map(et => et.key))
  const containedIds = new Set(
    (graphMap?.edges || []).filter(e => containmentRels.has(e.rel_type)).map(e => e.target_id)
  )
  const customTypeByKey = new Map(customTypes.map(nt => [nt.key, nt]))
  const unfiledNodes = (graphMap?.nodes || []).filter(
    n => customTypeByKey.has(n.type) && !containedIds.has(n.id)
  )

  return (
    <div className="kt-page">
      <div className="kt-page-header">
        <div className="kt-page-heading">
          <h1 className="kt-page-title">{t('unfiled.title')}</h1>
          <p className="kt-page-subtitle">{t('unfiled.subtitle')}</p>
        </div>
        <Inbox size={22} color="#818cf8" />
      </div>

      <div className="kt-card" style={{ padding: 20 }}>
        {isLoading ? (
          <div style={{ fontSize: 12, color: DARK.textDim }}>{t('loading')}</div>
        ) : tasks.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Inbox size={28} color={DARK.textDim} style={{ marginBottom: 8 }} />
            <div style={{ fontSize: 13, color: DARK.text, fontWeight: 600 }}>{t('unfiled.empty')}</div>
            <div style={{ fontSize: 12, color: DARK.textDim, marginTop: 4 }}>{t('unfiled.emptyHint')}</div>
          </div>
        ) : (
          tasks.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              projects={activeProjects}
              filing={fileMut.isPending}
              relations={relationsByNode[task.id]}
              edgeTypeByKey={edgeTypeByKey}
              onFile={(taskId, projectId) => fileMut.mutate({ taskId, projectId })}
            />
          ))
        )}
      </div>

      {unfiledNodes.length > 0 && (
        <div className="kt-card" style={{ padding: 20, marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Boxes size={15} color="#818cf8" />
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: DARK.text }}>{t('unfiled.nodes')}</h3>
            <span style={{ fontSize: 11, color: DARK.textDim }}>{unfiledNodes.length}</span>
          </div>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: DARK.textDim }}>{t('unfiled.nodesHint')}</p>
          {unfiledNodes.map(n => {
            const nt = customTypeByKey.get(n.type)
            const color = nt?.color || '#818cf8'
            return (
              <Link
                key={n.id}
                to={hasNodeRole(nt, 'container') ? `/c/${n.id}` : `/n/${n.id}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                  borderBottom: `1px solid ${DARK.border}`, textDecoration: 'none',
                }}
              >
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                  textTransform: 'uppercase', letterSpacing: 0.4,
                  color, background: `${color}22`, border: `1px solid ${color}44`,
                }}>
                  {nt?.label || n.type}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, color: DARK.text }}>
                    {n.title || <em style={{ color: DARK.textDim }}>{t('nodePage.untitled')}</em>}
                  </span>
                  <RelationChips counts={relationsByNode[n.id]} edgeTypeByKey={edgeTypeByKey} />
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
