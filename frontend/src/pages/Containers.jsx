import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Boxes, Layers, Shapes } from 'lucide-react'
import { getNodeTypes } from '../api/client'
import { qk } from '../api/queryKeys'
import { hasNodeRole } from '../constants/nodeRoles'
import EmptyState from '../components/shared/EmptyState'
import s from './Containers.module.css'

// One rail entry for every user-defined container type instead of one per type
// (ADR-0066): the types are navigation, but their number is unbounded, so the
// list lives on a page and the rail carries a single fixed door to it.
export default function Containers() {
  const { t } = useTranslation()
  const { data: nodeTypes = [], isLoading } = useQuery({
    queryKey: qk.nodeTypes(),
    queryFn: getNodeTypes,
    staleTime: 300000,
  })

  const containerTypes = nodeTypes.filter(nt => hasNodeRole(nt, 'container') && !nt.is_builtin)

  return (
    <div className="kt-page">
      <div className="kt-page-header">
        <div className="kt-page-heading">
          <h1 className="kt-page-title">{t('nav.containers')}</h1>
          <p className="kt-page-subtitle">{t('containers.subtitle', { count: containerTypes.length })}</p>
        </div>
        <Layers size={22} color="#818cf8" />
      </div>

      {isLoading ? (
        <div className={s.loading}>{t('loading')}</div>
      ) : containerTypes.length === 0 ? (
        <EmptyState
          icon={<Shapes size={36} className="kt-empty-icon" />}
          message={t('containers.empty')}
          hint={t('containers.emptyHint')}
          action={<Link to="/graph-types" className="kt-btn kt-btn-primary">{t('containers.manageTypes')}</Link>}
        />
      ) : (
        <div className={s.grid}>
          {containerTypes.map(nt => (
            <Link
              key={nt.key}
              to={`/t/${nt.key}`}
              className={`kt-card ${s.card}`}
              style={{ '--type-color': nt.color || '#818cf8' }}
            >
              <span className={s.icon}><Boxes size={18} color={nt.color || '#818cf8'} /></span>
              <span className={s.body}>
                <b className={s.label}>{nt.label}</b>
                <span className={s.key}>{nt.key}</span>
              </span>
              <span className={s.count}>{t('containers.nodeCount', { count: nt.usage_count ?? 0 })}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
