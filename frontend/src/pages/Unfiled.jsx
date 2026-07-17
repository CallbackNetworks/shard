import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Inbox, FolderInput } from 'lucide-react'
import { getUnfiledTasks, fileTaskIntoProject, getProjects } from '../api/client'
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
    </div>
  )
}
