import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Gavel } from 'lucide-react'
import { getDecisionsGoverning } from '../api/client'
import { qk } from '../api/queryKeys'
import { DECISION_STATUS_COLORS as STATUS_COLORS } from '../constants/theme'
import s from './GoverningDecisions.module.css'

/**
 * What decided this node (ADR-0118's `governs`, read from the work's side).
 *
 * The relation shipped with a read endpoint, a reverse read endpoint and two client
 * helpers, and not one caller: a decision could say what it governed and the governed
 * work could not say what decided it. That asymmetry is the whole point of the relation
 * — the person looking at a task is the one who does not know why it exists.
 *
 * Renders nothing when the node is governed by nothing, so it costs an empty row on no
 * page: every node has this component and almost none has an answer yet.
 */
export default function GoverningDecisions({ nodeId, className = '' }) {
  const { t } = useTranslation()
  const { data: decisions = [] } = useQuery({
    queryKey: qk.governingDecisions(nodeId),
    queryFn: () => getDecisionsGoverning(nodeId),
    enabled: !!nodeId,
    staleTime: 30000,
  })

  if (decisions.length === 0) return null

  return (
    <div className={`${s.root} ${className}`}>
      <div className={s.head}>
        <Gavel size={11} />
        {t('decisions.governedBy', { count: decisions.length })}
      </div>
      <div className={s.chips}>
        {decisions.map(d => {
          const style = STATUS_COLORS[d.decision_status || 'proposed'] || STATUS_COLORS.proposed
          return (
            <Link key={d.id} to={`/n/${d.id}`} className={s.chip} style={{ borderColor: style.color, color: style.color }}>
              <span className={s.chipName}>{d.name}</span>
              <span className={s.chipStatus}>{t(`decisions.${d.decision_status || 'proposed'}`)}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
