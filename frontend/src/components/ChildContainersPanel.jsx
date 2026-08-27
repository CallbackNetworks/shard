import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Boxes, ChevronRight } from 'lucide-react'
import { getContainerSubtree, getNodeTypes } from '../api/client'
import { qk } from '../api/queryKeys'
import { containerRoute } from '../utils/containerRoute'
import ProgressBar from './ProgressBar'
import s from './ChildContainersPanel.module.css'

// The level below this one (ADR-0065). A container's `contains` children split into
// tasks (the board) and containers; every view used to read only the task half, so a
// container nested under this one — and all the work inside it — was invisible here.
// Rollup numbers come from the server, never recomputed from the tasks on screen.
export default function ChildContainersPanel({ nodeId }) {
  const { t } = useTranslation()
  const { data: subtree } = useQuery({
    queryKey: qk.containerSubtree(nodeId),
    queryFn: () => getContainerSubtree(nodeId),
    enabled: !!nodeId,
  })
  const { data: nodeTypes = [] } = useQuery({ queryKey: qk.nodeTypes(), queryFn: getNodeTypes, staleTime: 300000 })

  const children = subtree?.children || []
  if (children.length === 0) return null

  return (
    <div className={s.panel}>
      <div className={s.title}>
        <Boxes size={13} />
        {t('containers.children', { count: children.length })}
      </div>
      <div className={s.grid}>
        {children.map(child => {
          const typeMeta = nodeTypes.find(nt => nt.key === child.type)
          const color = typeMeta?.color || '#818cf8'
          return (
            <Link key={child.id} to={containerRoute(child.id, child.type)} className={s.card}>
              <div className={s.cardHead}>
                <span className={s.badge} style={{ color, background: `${color}22`, borderColor: `${color}44` }}>
                  {typeMeta?.label || child.type}
                </span>
                <span className={s.cardTitle}>{child.title || t('nodePage.untitled')}</span>
                <ChevronRight size={13} className={s.chevron} />
              </div>
              <ProgressBar value={child.progress} />
              <div className={s.meta}>
                <span>{t('containers.tasksDone', { done: child.done_tasks, total: child.total_tasks })}</span>
                {child.child_container_count > 0 && (
                  <span className={s.deeper}>{t('containers.deeper', { count: child.child_container_count })}</span>
                )}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
