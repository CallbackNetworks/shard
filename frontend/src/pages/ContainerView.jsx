import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Boxes, Link2, Search } from 'lucide-react'
import { getNode, getNodeTypes, getContainedTasks, getContainerSubtree, updateTask, deleteTask } from '../api/client'
import NodeShareFacet from '../components/NodeShareFacet'
import ChildContainersPanel from '../components/ChildContainersPanel'
import { DARK } from '../constants/theme'
import { hasNodeRole } from '../constants/nodeRoles'
import BoardView from '../components/BoardView'
import TableView from '../components/TableView'
import EmptyState from '../components/shared/EmptyState'

// Container view for user-defined container types (ADR-0037): the same
// board/table machinery as ProjectDetail, fed from the generic
// /nodes/{id}/contained-tasks endpoint. Project-only features (cycles, labels,
// share, integrations) are deliberately absent — projects keep their richer
// dedicated page.

export default function ContainerView() {
  const { id } = useParams()
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: node, isLoading, isError } = useQuery({ queryKey: ['node', id], queryFn: () => getNode(id) })
  const { data: tasks = [] } = useQuery({
    queryKey: ['contained-tasks', id],
    queryFn: () => getContainedTasks(id),
    enabled: !!node,
  })
  const { data: nodeTypes = [] } = useQuery({ queryKey: ['node-types'], queryFn: getNodeTypes, staleTime: 300000 })
  // Subtree rollup (ADR-0065): the board below shows this container's direct tasks,
  // the header counts everything it transitively contains. Server-computed — the
  // difference between the two numbers is exactly what used to go missing.
  const { data: subtree } = useQuery({
    queryKey: ['container-subtree', id],
    queryFn: () => getContainerSubtree(id),
    enabled: !!node,
  })
  const nestedTaskCount = subtree ? subtree.total_tasks - subtree.direct_task_count : 0

  const [view, setView] = useState('table')
  const [search, setSearch] = useState('')

  const typeMeta = nodeTypes.find(nt => nt.key === node?.type)
  const color = typeMeta?.color || '#818cf8'

  // Task mutations reuse the project-scoped endpoint via the task's compat
  // project_id (its oldest membership). Tasks with no project stay read-only.
  const updateMut = useMutation({
    mutationFn: ({ projectId, taskId, data }) => updateTask(projectId, taskId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contained-tasks', id] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
  const handleUpdate = (taskId, data) => {
    const task = tasks.find(x => x.id === taskId)
    if (task?.project_id) updateMut.mutate({ projectId: task.project_id, taskId, data })
  }
  const deleteMut = useMutation({
    mutationFn: ({ projectId, taskId }) => deleteTask(projectId, taskId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contained-tasks', id] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
  const handleDelete = (taskId) => {
    const task = tasks.find(x => x.id === taskId)
    if (task?.project_id) deleteMut.mutate({ projectId: task.project_id, taskId })
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tasks
    return tasks.filter(x => (x.title || '').toLowerCase().includes(q))
  }, [tasks, search])

  if (isLoading) return <div className="kt-page"><div style={{ fontSize: 12, color: DARK.textDim }}>{t('loading')}</div></div>
  if (isError || !node) {
    return <div className="kt-page"><EmptyState message={t('nodePage.notFound')} /></div>
  }

  return (
    <div className="kt-page">
      <div className="kt-page-header">
        <div className="kt-page-heading">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 3,
              textTransform: 'uppercase', letterSpacing: 0.5,
              color, background: `${color}22`, border: `1px solid ${color}44`,
            }}>
              {typeMeta?.label || node.type}
            </span>
            <h1 className="kt-page-title" style={{ margin: 0 }}>
              {node.title || <em style={{ color: DARK.textDim }}>{t('nodePage.untitled')}</em>}
            </h1>
            <span style={{ fontSize: 12, color: DARK.textDim }}>
              {t('containerView.count', { n: subtree?.total_tasks ?? tasks.length })}
              {nestedTaskCount > 0 && ` ${t('containers.nestedNote', { n: nestedTaskCount })}`}
            </span>
          </div>
          <p className="kt-page-subtitle" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Link to={`/n/${id}`} style={{ color: DARK.textMid, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Link2 size={12} /> {t('containerView.relations')}
            </Link>
          </p>
        </div>
        <Boxes size={22} color={color} />
      </div>

      {hasNodeRole(typeMeta, 'shareable') && (
        <NodeShareFacet node={node} subscribable={hasNodeRole(typeMeta, 'subscribable')} />
      )}

      <ChildContainersPanel nodeId={id} />


      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '0 1 260px' }}>
          <Search size={12} color={DARK.textDim} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            className="kt-input" style={{ width: '100%', paddingLeft: 26 }}
            placeholder={t('containerView.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {['table', 'board'].map(v => (
            <button
              key={v}
              className={view === v ? 'kt-btn kt-btn-primary' : 'kt-btn'}
              onClick={() => setView(v)}
            >
              {t(`containerView.view.${v}`)}
            </button>
          ))}
        </div>
      </div>

      {tasks.length === 0 ? (
        // "Nothing here" is only true if nothing is nested either — otherwise the
        // work is real and one level down, which is what the panel above lists.
        <EmptyState
          message={t('containerView.empty')}
          hint={nestedTaskCount > 0 ? t('containers.emptyButNested', { n: nestedTaskCount }) : t('containerView.emptyHint')}
        />
      ) : view === 'board' ? (
        <BoardView
          tasks={filtered}
          projectCode=""
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onReorder={() => {}}
          wipLimits={{}}
        />
      ) : (
        <TableView
          tasks={filtered}
          projectId={null}
          labels={[]}
          cycles={[]}
          onUpdate={handleUpdate}
          onReorder={() => {}}
        />
      )}
    </div>
  )
}
