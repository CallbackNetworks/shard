import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

function hasInspectorMetrics(node) {
  return ['project', 'identity', 'task', 'goal', 'decision'].includes(node?.type)
}

export default function MapInspector({ selected, taskById, projectById, onSelect, onClear, onJump }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  if (!selected) {
    return (
      <aside className="kt-map-inspector">
        <span>{t('structure.inspector')}</span>
        <h2>{t('structure.selectNode')}</h2>
        <p>{t('structure.selectHint')}</p>
      </aside>
    )
  }

  return (
    <aside className="kt-map-inspector">
      <span>{selected.type || selected.lane}</span>
      <h2>{selected.name}</h2>
      <p>{selected.status || selected.risk || t('active')}</p>
      {hasInspectorMetrics(selected) && (
        <div className="kt-map-inspector-metrics">
          {selected.type === 'project' && (
            <>
              <div><b>{selected.progress}%</b><span>{t('structure.progress')}</span></div>
              <div><b>{selected.failed + selected.overdue}</b><span>{t('structure.risk')}</span></div>
              <div><b>{selected.pendingDecisionCount}</b><span>{t('pending')}</span></div>
              <div><b>{selected.dependencyCount || 0}</b><span>{t('structure.dependencies')}</span></div>
            </>
          )}
          {selected.type === 'identity' && (
            <>
              <div><b>{selected.projectCount}</b><span>{t('structure.projects')}</span></div>
              <div><b>{selected.shareActive ? t('active') : t('inactive')}</b><span>{t('structure.share')}</span></div>
            </>
          )}
          {selected.type === 'task' && (
            <>
              <div><b>{selected.priority || '-'}</b><span>{t('priority')}</span></div>
              <div><b>{selected.risk}</b><span>{t('structure.risk')}</span></div>
              <div><b>{selected.assignee || '-'}</b><span>{t('assignee')}</span></div>
            </>
          )}
          {selected.type === 'goal' && (
            <>
              <div><b>{selected.progress}%</b><span>{t('structure.progress')}</span></div>
              <div><b>{selected.projectIds?.length || 0}</b><span>{t('structure.projects')}</span></div>
            </>
          )}
          {selected.type === 'decision' && (
            <div><b>{selected.status}</b><span>{t('structure.decisionState')}</span></div>
          )}
        </div>
      )}
      {selected.type === 'task' && (
        <div className="kt-map-dependencies">
          <div>
            <strong>{t('structure.dependsOn')}</strong>
            {(selected.blockedBy || []).length === 0 ? (
              <span>{t('deps.noBlockers')}</span>
            ) : (
              selected.blockedBy.map(taskId => {
                const task = taskById.get(taskId)
                return (
                  <button key={taskId} type="button" onClick={() => task && onSelect(task)}>
                    {task?.name || taskId.slice(-8)}
                  </button>
                )
              })
            )}
          </div>
          <div>
            <strong>{t('structure.blocks')}</strong>
            {(selected.blocking || []).length === 0 ? (
              <span>{t('structure.noBlocking')}</span>
            ) : (
              selected.blocking.map(taskId => {
                const task = taskById.get(taskId)
                return (
                  <button key={taskId} type="button" onClick={() => task && onSelect(task)}>
                    {task?.name || taskId.slice(-8)}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
      {selected.type === 'goal' && (selected.projectIds || []).length > 0 && (
        <div className="kt-map-dependencies">
          <div>
            <strong>{t('structure.linkedProjects')}</strong>
            {selected.projectIds.map(projectId => {
              const project = projectById.get(projectId)
              return (
                <button key={projectId} type="button" onClick={() => navigate(`/projects/${projectId}`)}>
                  {project?.name || projectId.slice(-8)}
                </button>
              )
            })}
          </div>
        </div>
      )}
      {selected.type === 'identity' && (selected.projectIds || []).length > 0 && (
        <div className="kt-map-dependencies">
          <div>
            <strong>{t('structure.linkedProjects')}</strong>
            {selected.projectIds.map(projectId => {
              const project = projectById.get(projectId)
              return (
                <button key={projectId} type="button" onClick={() => navigate(`/projects/${projectId}`)}>
                  {project?.name || projectId.slice(-8)}
                </button>
              )
            })}
          </div>
        </div>
      )}
      {['project', 'task', 'identity', 'goal', 'decision'].includes(selected.type) && (
        <button className="kt-map-open" onClick={() => onJump(selected)}>
          {t(`structure.open.${selected.type}`)}
        </button>
      )}
      {/* Every entity is a node (ADR-0032/0033): deep-link to its graph page. */}
      {selected.type !== 'root' && selected.id && (
        <button className="kt-map-open" onClick={() => navigate(`/n/${selected.id}`)}>
          {t('structure.openNode')}
        </button>
      )}
      <button onClick={onClear}>{t('clear')}</button>
    </aside>
  )
}
