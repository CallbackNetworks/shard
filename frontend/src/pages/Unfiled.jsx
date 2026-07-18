import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Inbox, FolderInput, Boxes } from 'lucide-react'
import {
  getUnfiledTasks, fileTaskIntoProject, getProjects,
  getNodeTypes, getEdgeTypes, getGraphMap,
} from '../api/client'
import { DARK } from '../constants/theme'

function TaskRow({ task, projects, onFile, filing }) {
  const { t } = useTranslation()
  const [projectId, setProjectId] = useState('')
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 0', borderBottom: `1px solid ${DARK.border}`,
    }}>
      <span style={{ flex: 1, fontSize: 13, color: DARK.text }}>{task.title}</span>
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

  const { data: tasks = [], isLoading } = useQuery({ queryKey: ['unfiled-tasks'], queryFn: getUnfiledTasks })
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: getProjects })

  const fileMut = useMutation({
    mutationFn: ({ taskId, projectId }) => fileTaskIntoProject(taskId, projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['unfiled-tasks'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  const activeProjects = projects.filter(p => p.status !== 'archived')

  // Unfiled custom nodes (ADR-0037): custom-type nodes with no incoming
  // containment edge, derived client-side from the /graph/map slice.
  const { data: nodeTypes = [] } = useQuery({ queryKey: ['node-types'], queryFn: getNodeTypes, staleTime: 300000 })
  const { data: edgeTypes = [] } = useQuery({ queryKey: ['edge-types'], queryFn: getEdgeTypes, staleTime: 300000 })
  const customTypes = nodeTypes.filter(nt => !nt.is_builtin)
  const { data: graphMap } = useQuery({
    queryKey: ['graph-map', 'unfiled'],
    queryFn: () => getGraphMap(),
    enabled: customTypes.length > 0,
  })
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
                to={`/n/${n.id}`}
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
                <span style={{ flex: 1, fontSize: 13, color: DARK.text }}>
                  {n.title || <em style={{ color: DARK.textDim }}>{t('nodePage.untitled')}</em>}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
